import { skipToken } from '@reduxjs/toolkit/query/react';
import { memo, useMemo } from 'react';
import { Controller, useFormContext } from 'react-hook-form';

import { t } from '@grafana/i18n';
import { Field, TextArea, Input, RadioButtonGroup, Combobox } from '@grafana/ui';
import { RepositoryView, useGetRepositoryRefsQuery } from 'app/api/clients/provisioning/v0alpha1';
import { BranchValidationError } from 'app/features/provisioning/Shared/BranchValidationError';
import { WorkflowOption } from 'app/features/provisioning/types';
import { validateBranchName } from 'app/features/provisioning/utils/git';
import { isGitProvider } from 'app/features/provisioning/utils/repositoryTypes';

interface DashboardEditFormSharedFieldsProps {
  resourceType: 'dashboard' | 'folder';
  workflowOptions: Array<{ label: string; value: string }>;
  isNew?: boolean;
  readOnly?: boolean;
  workflow?: WorkflowOption;
  repository?: RepositoryView;
  hidePath?: boolean;
}

export const ResourceEditFormSharedFields = memo<DashboardEditFormSharedFieldsProps>(
  ({ readOnly = false, workflow, workflowOptions, repository, isNew, resourceType, hidePath = false }) => {
    const {
      control,
      register,
      formState: { errors },
    } = useFormContext();

    const {
      data: branchData,
      isLoading: branchLoading,
      error: branchError,
    } = useGetRepositoryRefsQuery(
      !repository?.name || !isGitProvider(repository.type) ? skipToken : { name: repository.name }
    );

    const branchOptions = useMemo(() => {
      if (!branchData?.items) {
        return [];
      }

      return branchData.items.map((ref) => ({
        label: ref.name,
        value: ref.name,
      }));
    }, [branchData?.items]);

    const pathText =
      resourceType === 'dashboard'
        ? t(
            'provisioned-resource-form.save-or-delete-resource-shared-fields.description-file-path',
            'File path inside the repository (.json or .yaml)'
          )
        : t(
            'provisioned-resource-form.save-or-delete-resource-shared-fields.description-folder-path',
            'Folder path inside the repository'
          );

    return (
      <>
        {/* Path */}
        {!hidePath && (
          <Field
            noMargin
            label={t('provisioned-resource-form.save-or-delete-resource-shared-fields.label-path', 'Path')}
            description={t(
              'provisioned-resource-form.save-or-delete-resource-shared-fields.description-inside-repository',
              pathText
            )}
          >
            <Input id="dashboard-path" type="text" {...register('path')} readOnly={!isNew} />
          </Field>
        )}

        {/* Comment */}
        <Field
          noMargin
          label={t('provisioned-resource-form.save-or-delete-resource-shared-fields.label-comment', 'Comment')}
        >
          <TextArea
            id="provisioned-resource-form-comment"
            {...register('comment')}
            disabled={readOnly}
            placeholder={t(
              'provisioned-resource-form.save-or-delete-resource-shared-fields.comment-placeholder-describe-changes-optional',
              'Add a note to describe your changes (optional)'
            )}
            rows={5}
          />
        </Field>

        {/* Workflow */}
        {repository?.type && isGitProvider(repository.type) && !readOnly && (
          <>
            <Field
              noMargin
              label={t('provisioned-resource-form.save-or-delete-resource-shared-fields.label-workflow', 'Workflow')}
            >
              <Controller
                control={control}
                name="workflow"
                render={({ field: { ref: _, ...field } }) => (
                  <RadioButtonGroup id="provisioned-resource-form-workflow" {...field} options={workflowOptions} />
                )}
              />
            </Field>
            {workflow === 'branch' && (
              <Field
                noMargin
                label={t('provisioned-resource-form.save-or-delete-resource-shared-fields.label-branch', 'Branch')}
                description={t(
                  'provisioned-resource-form.save-or-delete-resource-shared-fields.description-branch-name-in-git-hub',
                  'Branch name in GitHub'
                )}
                invalid={Boolean(errors.ref || branchError)}
                error={
                  errors.ref ? (
                    <BranchValidationError />
                  ) : branchError ? (
                    t('provisioning.config-form.error-fetch-branches', 'Failed to fetch branches')
                  ) : undefined
                }
              >
                <Controller
                  name="ref"
                  control={control}
                  rules={{ validate: validateBranchName }}
                  render={({ field: { ref, onChange, ...field } }) => (
                    <Combobox
                      invalid={!!errors.ref}
                      onChange={(option) => onChange(option?.value || '')}
                      placeholder={t(
                        'provisioned-resource-form.save-or-delete-resource-shared-fields.placeholder-branch',
                        'Select or enter branch name'
                      )}
                      options={branchOptions}
                      loading={branchLoading}
                      isClearable
                      {...field}
                    />
                  )}
                />
              </Field>
            )}
          </>
        )}
      </>
    );
  }
);
ResourceEditFormSharedFields.displayName = 'ResourceEditFormSharedFields';
