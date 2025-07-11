package app

import (
	"context"

	"github.com/grafana/grafana/pkg/setting"

	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/k8s"
	"github.com/grafana/grafana-app-sdk/logging"
	"github.com/grafana/grafana-app-sdk/operator"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-app-sdk/simple"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/rest"
	"k8s.io/klog/v2"

	settings "github.com/grafana/grafana/apps/settings/pkg/apis/settings/v0alpha1"
	mutators "github.com/grafana/grafana/apps/settings/pkg/mutators"
	reconcilers "github.com/grafana/grafana/apps/settings/pkg/reconcilers"
	validators "github.com/grafana/grafana/apps/settings/pkg/validators"
)

func New(cfg app.Config) (app.App, error) {
	log := logging.DefaultLogger.With("app", "settings")

	patchClient, err := getPatchClient(cfg.KubeConfig, settings.SettingKind())
	if err != nil {
		klog.ErrorS(err, "Error getting patch client for use with opinionated reconciler")
		return nil, err
	}

	pCfg := cfg.SpecificConfig.(*setting.Cfg)

	settingReconciler, err := reconcilers.NewSettingReconciler(patchClient, pCfg)
	if err != nil {
		klog.ErrorS(err, "Error creating setting reconciler")
		return nil, err
	}

	simpleConfig := simple.AppConfig{
		Name:       "settings",
		KubeConfig: cfg.KubeConfig,
		InformerConfig: simple.AppInformerConfig{
			ErrorHandler: func(ctx context.Context, err error) {
				log.WithContext(ctx).Error("Informer processing error", "error", err)
			},
		},
		ManagedKinds: []simple.AppManagedKind{
			{
				Kind:       settings.SettingKind(),
				Reconciler: settingReconciler,
				Validator:  validators.NewSettingsValidator(log),
				Mutator:    mutators.NewSettingsMutator(log),
			},
		},
	}

	a, err := simple.NewApp(simpleConfig)
	if err != nil {
		return nil, err
	}

	err = a.ValidateManifest(cfg.ManifestData)
	if err != nil {
		return nil, err
	}

	return a, nil
}

func GetKinds() map[schema.GroupVersion][]resource.Kind {
	gv := schema.GroupVersion{
		Group:   settings.SettingKind().Group(),
		Version: settings.SettingKind().Version(),
	}
	return map[schema.GroupVersion][]resource.Kind{
		gv: {settings.SettingKind()},
	}
}

func getPatchClient(restConfig rest.Config, settingKind resource.Kind) (operator.PatchClient, error) {
	clientGenerator := k8s.NewClientRegistry(restConfig, k8s.ClientConfig{})
	return clientGenerator.ClientFor(settingKind)
}
