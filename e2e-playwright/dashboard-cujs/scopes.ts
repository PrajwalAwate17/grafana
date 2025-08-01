import { SECOND_DASHBOARD } from './dashboard-navigation.spec';
import { TestScope } from './scopeUtils';

export const testScopes: TestScope[] = [
  {
    name: 'sn-databases',
    title: 'Databases',
    children: [
      {
        name: 'sn-databases-m',
        title: 'Mimir',
        children: [
          {
            name: 'sn-databases-m-mimir-dev-10',
            title: 'mimir-dev-10',
            filters: [{ key: 'namespace', operator: 'equals', value: 'mimir-dev-10' }],
            dashboardTitle: 'Scopes Dashboard 2',
            dashboardUid: SECOND_DASHBOARD,
            addLinks: true,
          },
          {
            name: 'sn-databases-m-mimir-dev-11',
            title: 'mimir-dev-11',
            filters: [{ key: 'namespace', operator: 'equals', value: 'mimir-dev-11' }],
            addLinks: true,
          },
        ],
      },
      {
        name: 'sn-databases-l',
        title: 'Loki',
        children: [
          {
            name: 'sn-databases-l-loki-dev-010',
            title: 'loki-dev-010',
            filters: [{ key: 'namespace', operator: 'equals', value: 'loki-dev-010' }],
            dashboardTitle: 'Scopes Dashboard 2',
            dashboardUid: SECOND_DASHBOARD,
            addLinks: true,
          },
          {
            name: 'sn-databases-l-loki-dev-009',
            title: 'loki-dev-009',
            filters: [{ key: 'namespace', operator: 'equals', value: 'loki-dev-009' }],
            addLinks: true,
          },
        ],
      },
    ],
  },
  {
    name: 'sn-hg',
    title: 'Hosted Grafana',
    children: [
      {
        name: 'sn-hg-c',
        title: 'Cluster',
        children: [
          {
            name: 'sn-hg-c-dev-eu-west-2-hosted-grafana',
            title: 'dev-eu-west-2',
            filters: [{ key: 'cluster', operator: 'equals', value: 'dev-eu-west-2' }],
            dashboardTitle: 'Scopes Dashboard 2',
            dashboardUid: SECOND_DASHBOARD,
            addLinks: true,
          },
          {
            name: 'sn-hg-c-dev-us-central-0-hosted-grafana',
            title: 'dev-us-central-0',
            filters: [{ key: 'cluster', operator: 'equals', value: 'dev-us-central-0' }],
            addLinks: true,
          },
        ],
      },
    ],
  },
  {
    name: 'sn-test',
    title: 'Test Multi Select',
    children: [
      {
        name: 'sn-test-c',
        title: 'Cluster',
        disableMultiSelect: true,
        children: [
          {
            name: 'sn-test-c-multi',
            title: 'Multi group',
            children: [],
            addLinks: true,
          },
          {
            name: 'sn-test-c-another',
            title: 'Another group',
            addLinks: true,
            filters: [],
          },
        ],
      },
    ],
  },
];
