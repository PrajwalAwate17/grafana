package main

import (
	"context"
	"crypto/x509"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/grafana/authlib/authn"
	"github.com/grafana/grafana-app-sdk/logging"
	"github.com/urfave/cli/v2"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/transport"

	authrt "github.com/grafana/grafana/apps/provisioning/pkg/auth"
	"github.com/grafana/grafana/apps/provisioning/pkg/controller"
	client "github.com/grafana/grafana/apps/provisioning/pkg/generated/clientset/versioned"
	informer "github.com/grafana/grafana/apps/provisioning/pkg/generated/informers/externalversions"
	"github.com/grafana/grafana/pkg/registry/apis/provisioning/jobs"
	deletepkg "github.com/grafana/grafana/pkg/registry/apis/provisioning/jobs/delete"
	"github.com/grafana/grafana/pkg/registry/apis/provisioning/jobs/export"
	"github.com/grafana/grafana/pkg/registry/apis/provisioning/jobs/migrate"
	movepkg "github.com/grafana/grafana/pkg/registry/apis/provisioning/jobs/move"
	"github.com/grafana/grafana/pkg/registry/apis/provisioning/jobs/sync"
	"github.com/grafana/grafana/pkg/registry/apis/provisioning/repository"
	"github.com/grafana/grafana/pkg/registry/apis/provisioning/resources"
	"github.com/grafana/grafana/pkg/services/apiserver"
	"github.com/grafana/grafana/pkg/storage/unified/resourcepb"
)

var (
	token                 = flag.String("token", "", "Token to use for authentication")
	tokenExchangeURL      = flag.String("token-exchange-url", "", "Token exchange URL")
	provisioningServerURL = flag.String("provisioning-server-url", "", "Provisioning server URL")
	tlsInsecure           = flag.Bool("tls-insecure", true, "Skip TLS certificate verification")
	tlsCertFile           = flag.String("tls-cert-file", "", "Path to TLS certificate file")
	tlsKeyFile            = flag.String("tls-key-file", "", "Path to TLS private key file")
	tlsCAFile             = flag.String("tls-ca-file", "", "Path to TLS CA certificate file")
)

// QUESTION: is this the right way to do this? will it work?
// directConfigProvider always returns the provided rest.Config.
// implements RestConfigProvider interface
type directConfigProvider struct {
	cfg *rest.Config
}

func NewDirectConfigProvider(cfg *rest.Config) apiserver.RestConfigProvider {
	return &directConfigProvider{cfg: cfg}
}

func (r *directConfigProvider) GetRestConfig(ctx context.Context) (*rest.Config, error) {
	return r.cfg, nil
}

func main() {
	app := &cli.App{
		Name:  "job-controller",
		Usage: "Watch provisioning jobs and manage job history cleanup",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:        "token",
				Usage:       "Token to use for authentication",
				Value:       "",
				Destination: token,
			},
			&cli.StringFlag{
				Name:        "token-exchange-url",
				Usage:       "Token exchange URL",
				Value:       "",
				Destination: tokenExchangeURL,
			},
			&cli.StringFlag{
				Name:        "provisioning-server-url",
				Usage:       "Provisioning server URL",
				Value:       "",
				Destination: provisioningServerURL,
			},
			&cli.BoolFlag{
				Name:        "tls-insecure",
				Usage:       "Skip TLS certificate verification",
				Value:       true,
				Destination: tlsInsecure,
			},
			&cli.StringFlag{
				Name:        "tls-cert-file",
				Usage:       "Path to TLS certificate file",
				Value:       "",
				Destination: tlsCertFile,
			},
			&cli.StringFlag{
				Name:        "tls-key-file",
				Usage:       "Path to TLS private key file",
				Value:       "",
				Destination: tlsKeyFile,
			},
			&cli.StringFlag{
				Name:        "tls-ca-file",
				Usage:       "Path to TLS CA certificate file",
				Value:       "",
				Destination: tlsCAFile,
			},
			&cli.DurationFlag{
				Name:  "history-expiration",
				Usage: "Duration after which HistoricJobs are deleted; 0 disables cleanup. When the Provisioning API is configured to use Loki for job history, leave this at 0.",
				Value: 0,
			},
		},
		Action: runJobController,
	}

	if err := app.Run(os.Args); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func runJobController(c *cli.Context) error {
	logger := logging.NewSLogLogger(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	})).With("logger", "provisioning-job-controller")
	logger.Info("Starting provisioning job controller")

	tokenExchangeClient, err := authn.NewTokenExchangeClient(authn.TokenExchangeConfig{
		TokenExchangeURL: *tokenExchangeURL,
		Token:            *token,
	})
	if err != nil {
		return fmt.Errorf("failed to create token exchange client: %w", err)
	}

	tlsConfig, err := buildTLSConfig()
	if err != nil {
		return fmt.Errorf("failed to build TLS configuration: %w", err)
	}

	config := &rest.Config{
		APIPath: "/apis",
		Host:    *provisioningServerURL,
		WrapTransport: transport.WrapperFunc(func(rt http.RoundTripper) http.RoundTripper {
			return authrt.NewRoundTripper(tokenExchangeClient, rt)
		}),
		TLSClientConfig: tlsConfig,
	}

	client, err := client.NewForConfig(config)
	if err != nil {
		return fmt.Errorf("failed to create provisioning client: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigChan
		fmt.Println("Received shutdown signal, stopping controllers")
		cancel()
	}()

	// Jobs informer and controller (resync ~60s like in register.go)
	jobInformerFactory := informer.NewSharedInformerFactoryWithOptions(
		client,
		60*time.Second,
	)
	jobInformer := jobInformerFactory.Provisioning().V0alpha1().Jobs()
	jobController, err := controller.NewJobController(jobInformer)
	if err != nil {
		return fmt.Errorf("failed to create job controller: %w", err)
	}

	// Optionally enable history cleanup if a positive expiration is provided
	historyExpiration := c.Duration("history-expiration")
	var startHistoryInformers func()
	if historyExpiration > 0 {
		// History jobs informer and controller (separate factory with resync == expiration)
		historyInformerFactory := informer.NewSharedInformerFactoryWithOptions(
			client,
			historyExpiration,
		)
		historyJobInformer := historyInformerFactory.Provisioning().V0alpha1().HistoricJobs()
		_, err = controller.NewHistoryJobController(
			client.ProvisioningV0alpha1(),
			historyJobInformer,
			historyExpiration,
		)
		if err != nil {
			return fmt.Errorf("failed to create history job controller: %w", err)
		}
		logger.Info("history cleanup enabled", "expiration", historyExpiration.String())
		startHistoryInformers = func() { historyInformerFactory.Start(ctx.Done()) }
	} else {
		startHistoryInformers = func() {}
	}

	// HistoryWriter can be either Loki or the API server
	// TODO: Loki support
	// var jobHistoryWriter jobs.HistoryWriter
	// if b.jobHistoryLoki != nil {
	// 	jobHistoryWriter = b.jobHistoryLoki
	// } else {
	// 	jobHistoryWriter = jobs.NewAPIClientHistoryWriter(provisioningClient.ProvisioningV0alpha1())
	// }
	jobHistoryWriter := jobs.NewAPIClientHistoryWriter(client.ProvisioningV0alpha1())
	jobStore, err := jobs.NewJobStore(client.ProvisioningV0alpha1(), 30*time.Second)
	if err != nil {
		return fmt.Errorf("create API client job store: %w", err)
	}

	configProvider := &directConfigProvider{cfg: config}
	clients := resources.NewClientFactory(configProvider)
	parsers := resources.NewParserFactory(clients)

	// HACK: This is connecting to unified storage. It's ok for now as long as dashboards and folders are located in the
	// same cluster and namespace
	// This breaks when we start really trying to support any resource. This is on the search+storage roadmap to support federation at some level.
	// TODO: unified
	var (
		unified      resourcepb.ManagedObjectIndexClient = nil
		unifiedIndex resourcepb.ResourceIndexClient      = nil
	)

	resourceLister := resources.NewResourceLister(unified, unifiedIndex)
	repositoryResources := resources.NewRepositoryResourcesFactory(parsers, clients, resourceLister)

	stageIfPossible := repository.WrapWithStageAndPushIfPossible
	exportWorker := export.NewExportWorker(
		clients,
		repositoryResources,
		export.ExportAll,
		stageIfPossible,
	)

	statusPatcher := controller.NewRepositoryStatusPatcher(client.ProvisioningV0alpha1())
	syncer := sync.NewSyncer(sync.Compare, sync.FullSync, sync.IncrementalSync)
	syncWorker := sync.NewSyncWorker(
		clients,
		repositoryResources,
		nil, // HACK: we have updated the worker to check for nil
		statusPatcher.Patch,
		syncer,
	)

	cleaner := migrate.NewNamespaceCleaner(clients)
	unifiedStorageMigrator := migrate.NewUnifiedStorageMigrator(
		cleaner,
		exportWorker,
		syncWorker,
	)

	migrationWorker := migrate.NewMigrationWorkerFromUnified(unifiedStorageMigrator)
	deleteWorker := deletepkg.NewWorker(syncWorker, stageIfPossible, repositoryResources)
	moveWorker := movepkg.NewWorker(syncWorker, stageIfPossible, repositoryResources)

	workers := []jobs.Worker{
		deleteWorker,
		exportWorker,
		migrationWorker,
		moveWorker,
		syncWorker,
	}

	// This is basically our own JobQueue system
	// TODO: Add repository getter
	driver, err := jobs.NewConcurrentJobDriver(
		3,              // 3 drivers for now
		20*time.Minute, // Max time for each job
		time.Minute,    // Cleanup jobs
		30*time.Second, // Periodically look for new jobs
		30*time.Second, // Lease renewal interval
		jobStore,
		nil, // TODO: add repository getter
		jobHistoryWriter,
		jobController.InsertNotifications(),
		workers...,
	)

	go func() {
		logger.Info("jobs controller started")
		if err := driver.Run(ctx); err != nil {
			logger.Error("job driver failed", "error", err)
		}
	}()

	// Start informers
	go jobInformerFactory.Start(ctx.Done())
	go startHistoryInformers()

	// Optionally wait for job cache sync; history cleanup can rely on resync events
	if !cache.WaitForCacheSync(ctx.Done(), jobInformer.Informer().HasSynced) {
		return fmt.Errorf("failed to sync job informer cache")
	}

	<-ctx.Done()
	return nil
}

func buildTLSConfig() (rest.TLSClientConfig, error) {
	tlsConfig := rest.TLSClientConfig{
		Insecure: *tlsInsecure,
	}

	// If client certificate and key are provided
	if *tlsCertFile != "" && *tlsKeyFile != "" {
		tlsConfig.CertFile = *tlsCertFile
		tlsConfig.KeyFile = *tlsKeyFile
	}

	// If CA certificate is provided
	if *tlsCAFile != "" {
		caCert, err := os.ReadFile(*tlsCAFile)
		if err != nil {
			return tlsConfig, fmt.Errorf("failed to read CA certificate file: %w", err)
		}

		caCertPool := x509.NewCertPool()
		if !caCertPool.AppendCertsFromPEM(caCert) {
			return tlsConfig, fmt.Errorf("failed to parse CA certificate")
		}

		tlsConfig.CAData = caCert
	}

	return tlsConfig, nil
}
