import { test, expect } from '@grafana/plugin-e2e';

import { setScopes } from '../utils/scope-helpers';

test.use({
  featureToggles: {
    scopeFilters: true,
    groupByVariable: true,
    reloadDashboardsOnParamsChange: true,
  },
});

const USE_LIVE_DATA = Boolean(process.env.USE_LIVE_DATA);

export const DASHBOARD_UNDER_TEST = 'cuj-dashboard-1';

test.describe(
  'AdHoc Filters CUJs',
  {
    tag: ['@dashboard-cujs'],
  },
  () => {
    test('Filter data on a dashboard', async ({ page, selectors, gotoDashboardPage }) => {
      await test.step('1.Apply filtering to a whole dashboard', async () => {
        const dashboardPage = await gotoDashboardPage({ uid: DASHBOARD_UNDER_TEST });

        await page.waitForSelector('[aria-label*="Edit filter with key"]', {
          state: 'visible',
        });

        expect(await page.getByLabel(/^Edit filter with key/).count()).toBe(2);

        if (!USE_LIVE_DATA) {
          // mock the API call to get the labels
          const labels = ['asserts_env', 'cluster', 'job'];
          await page.route('**/resources/**/labels*', async (route) => {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                status: 'success',
                data: labels,
              }),
            });
          });

          // mock the API call to get the labels
          const values = ['value1', 'value2', 'value3'];
          await page.route('**/resources/**/values*', async (route) => {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                status: 'success',
                data: values,
              }),
            });
          });
        }

        const adHocVariable = dashboardPage
          .getByGrafanaSelector(selectors.pages.Dashboard.SubMenu.submenuItemLabels('adHoc'))
          .locator('..')
          .locator('input');

        const labelsResponsePromise = page.waitForResponse('**/resources/**/labels*');
        await adHocVariable.click();
        await labelsResponsePromise;
        await page.waitForSelector('[role="option"]', { state: 'visible' });
        await adHocVariable.press('Enter');
        await page.waitForSelector('[role="option"]', { state: 'visible' });
        const valuesResponsePromise = page.waitForResponse('**/resources/**/values*');
        await adHocVariable.press('Enter');
        await valuesResponsePromise;
        await page.waitForSelector('[role="option"]', { state: 'visible' });
        await adHocVariable.press('Enter');

        expect(await page.getByLabel(/^Edit filter with key/).count()).toBe(3);

        const pills = await page.getByLabel(/^Edit filter with key/).allTextContents();
        const processedPills = pills
          .map((p) => {
            const parts = p.split(' ');
            return `${parts[0]}${parts[1]}"${parts[2]}"`;
          })
          .join(',');

        // assert the panel is visible and has the correct value
        const panelContent = dashboardPage.getByGrafanaSelector(selectors.components.Panels.Panel.content).first();
        await expect(panelContent).toBeVisible();
        const markdownContent = panelContent.locator('.markdown-html');
        await expect(markdownContent).toContainText(`AdHocVar: ${processedPills}`);
      });

      await test.step('2.Autocomplete for the filter values', async () => {
        const dashboardPage = await gotoDashboardPage({ uid: DASHBOARD_UNDER_TEST });

        if (!USE_LIVE_DATA) {
          // mock the API call to get the labels
          const labels = ['asserts_env', 'cluster', 'job'];
          await page.route('**/resources/**/labels*', async (route) => {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                status: 'success',
                data: labels,
              }),
            });
          });

          // mock the API call to get the labels
          const values = ['value1', 'value2', 'value3', 'some', 'other', 'vals'];
          await page.route('**/resources/**/values*', async (route) => {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                status: 'success',
                data: values,
              }),
            });
          });
        }

        const adHocVariable = dashboardPage
          .getByGrafanaSelector(selectors.pages.Dashboard.SubMenu.submenuItemLabels('adHoc'))
          .locator('..')
          .locator('input');

        const labelsResponsePromise = page.waitForResponse('**/resources/**/labels*');
        await adHocVariable.click();
        await labelsResponsePromise;
        await adHocVariable.press('Enter');
        await page.waitForSelector('[role="option"]', { state: 'visible' });
        const valuesResponsePromise = page.waitForResponse('**/resources/**/values*');
        await adHocVariable.press('Enter');
        await valuesResponsePromise;

        const valuesLocator = page.getByTestId(/^data-testid ad hoc filter option value/);
        const valuesCount = await valuesLocator.count();
        const firstValue = await valuesLocator.first().textContent();

        await adHocVariable.fill(firstValue!.slice(0, -1));

        await page.waitForSelector('[role="option"]', { state: 'visible' });

        const newValuesCount = await valuesLocator.count();
        expect(newValuesCount).toBeLessThan(valuesCount);
        //exclude the custom value
        expect(newValuesCount).toBeGreaterThan(1);
      });

      await test.step('3.Choose operators on the filters', async () => {
        const dashboardPage = await gotoDashboardPage({ uid: DASHBOARD_UNDER_TEST });

        await page.waitForSelector('[aria-label*="Edit filter with key"]', {
          state: 'visible',
        });

        expect(await page.getByLabel(/^Edit filter with key/).count()).toBe(2);

        if (!USE_LIVE_DATA) {
          // mock the API call to get the labels
          const labels = ['asserts_env', 'cluster', 'job'];
          await page.route('**/resources/**/labels*', async (route) => {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                status: 'success',
                data: labels,
              }),
            });
          });

          // mock the API call to get the labels
          const values = ['value1', 'value2', 'value3'];
          await page.route('**/resources/**/values*', async (route) => {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                status: 'success',
                data: values,
              }),
            });
          });
        }

        const adHocVariable = dashboardPage
          .getByGrafanaSelector(selectors.pages.Dashboard.SubMenu.submenuItemLabels('adHoc'))
          .locator('..')
          .locator('input');

        const labelsResponsePromise = page.waitForResponse('**/resources/**/labels*');
        await adHocVariable.click();
        await labelsResponsePromise;
        await adHocVariable.press('Enter');
        await page.waitForSelector('[role="option"]', { state: 'visible' });
        await adHocVariable.press('ArrowDown');
        await adHocVariable.press('ArrowDown');
        await adHocVariable.press('ArrowDown');
        await adHocVariable.press('ArrowDown');
        const valuesResponsePromise = page.waitForResponse('**/resources/**/values*');
        await adHocVariable.press('Enter');
        await valuesResponsePromise;
        await adHocVariable.press('Enter');

        expect(await page.getByLabel(/^Edit filter with key/).count()).toBe(3);

        const pills = await page.getByLabel(/^Edit filter with key/).allTextContents();
        const processedPills = pills
          .map((p) => {
            const parts = p.split(' ');
            return `${parts[0]}${parts[1]}"${parts[2]}"`;
          })
          .join(',');

        // assert the panel is visible and has the correct value
        const panelContent = dashboardPage.getByGrafanaSelector(selectors.components.Panels.Panel.content).first();
        await expect(panelContent).toBeVisible();
        const markdownContent = panelContent.locator('.markdown-html');
        await expect(markdownContent).toContainText(`AdHocVar: ${processedPills}`);
        // regex operator applied to the filter
        await expect(markdownContent).toContainText(`=~`);
      });

      await test.step('4.Edit and restore default filters applied to the dashboard', async () => {
        const dashboardPage = await gotoDashboardPage({ uid: DASHBOARD_UNDER_TEST });

        const defaultDashboardFilter = page.getByLabel(/^Edit filter with key/).first();
        const pillText = await defaultDashboardFilter.textContent();

        const adHocVariable = dashboardPage
          .getByGrafanaSelector(selectors.pages.Dashboard.SubMenu.submenuItemLabels('adHoc'))
          .locator('..')
          .locator('input')
          .first();

        await defaultDashboardFilter.click();
        await adHocVariable.fill('new value');
        await adHocVariable.press('Enter');

        expect(await defaultDashboardFilter.textContent()).not.toBe(pillText);

        const restoreButton = page.getByLabel('Restore the value set by this dashboard.');
        await restoreButton.click();

        expect(await defaultDashboardFilter.textContent()).toBe(pillText);
      });

      await test.step('5.Edit and restore filters implied by scope', async () => {
        const dashboardPage = await gotoDashboardPage({ uid: DASHBOARD_UNDER_TEST });

        await page.waitForSelector('[aria-label*="Edit filter with key"]', {
          state: 'visible',
        });

        expect(await page.getByLabel(/^Edit filter with key/).count()).toBe(2);

        await setScopes(page, USE_LIVE_DATA);

        await expect(page.getByTestId('scopes-selector-input')).toHaveValue(/.+/);

        expect(await page.getByLabel(/^Edit filter with key/).count()).toBe(3);

        const defaultDashboardFilter = page.getByLabel(/^Edit filter with key/).first();
        const pillText = await defaultDashboardFilter.textContent();

        const adHocVariable = dashboardPage
          .getByGrafanaSelector(selectors.pages.Dashboard.SubMenu.submenuItemLabels('adHoc'))
          .locator('..')
          .locator('input')
          .first();

        await defaultDashboardFilter.click();
        await adHocVariable.fill('new value');
        await adHocVariable.press('Enter');

        expect(await defaultDashboardFilter.textContent()).not.toBe(pillText);

        const restoreButton = page.getByLabel('Restore the value set by your selected scope.');
        await restoreButton.click();

        expect(await defaultDashboardFilter.textContent()).toBe(pillText);
      });

      await test.step('6.Add and edit filters through keyboard', async () => {
        const dashboardPage = await gotoDashboardPage({ uid: DASHBOARD_UNDER_TEST });

        await page.waitForSelector('[aria-label*="Edit filter with key"]', {
          state: 'visible',
        });

        expect(await page.getByLabel(/^Edit filter with key/).count()).toBe(2);

        if (!USE_LIVE_DATA) {
          // mock the API call to get the labels
          const labels = ['asserts_env', 'cluster', 'job'];
          await page.route('**/resources/**/labels*', async (route) => {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                status: 'success',
                data: labels,
              }),
            });
          });

          // mock the API call to get the labels
          const values = ['value1', 'value2', 'value3'];
          await page.route('**/resources/**/values*', async (route) => {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                status: 'success',
                data: values,
              }),
            });
          });
        }

        const adHocVariable = dashboardPage
          .getByGrafanaSelector(selectors.pages.Dashboard.SubMenu.submenuItemLabels('adHoc'))
          .locator('..')
          .locator('input');

        const labelsResponsePromise = page.waitForResponse('**/resources/**/labels*');
        await adHocVariable.click();
        await labelsResponsePromise;
        await adHocVariable.press('Enter');
        await page.waitForSelector('[role="option"]', { state: 'visible' });
        const valuesResponsePromise = page.waitForResponse('**/resources/**/values*');
        await adHocVariable.press('Enter');
        await valuesResponsePromise;
        const secondLabelsPromise = page.waitForResponse('**/resources/**/labels*');
        await adHocVariable.press('Enter');

        // add another filter
        await secondLabelsPromise;
        await adHocVariable.press('ArrowDown');
        await adHocVariable.press('Enter');
        // arrow down to multivalue op
        await adHocVariable.press('ArrowDown');
        await adHocVariable.press('ArrowDown');
        await adHocVariable.press('ArrowDown');
        const secondValuesResponsePromise = page.waitForResponse('**/resources/**/values*');
        await adHocVariable.press('Enter');
        await secondValuesResponsePromise;
        //select firs value, then arrow down to another
        await adHocVariable.press('Enter');
        await adHocVariable.press('ArrowDown');
        await adHocVariable.press('Enter');
        //escape applies it
        await adHocVariable.press('Escape');

        expect(await page.getByLabel(/^Edit filter with key/).count()).toBe(4);

        //remove last value through keyboard
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Enter');

        expect(await page.getByLabel(/^Edit filter with key/).count()).toBe(3);
      });
    });
  }
);
