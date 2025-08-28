package resourcepermission

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/grafana/authlib/types"
	"github.com/grafana/grafana/apps/iam/pkg/apis/iam/v0alpha1"
	"github.com/grafana/grafana/pkg/registry/apis/iam/legacy"
	"github.com/grafana/grafana/pkg/services/accesscontrol"
	"github.com/grafana/grafana/pkg/services/sqlstore/session"
	"github.com/grafana/grafana/pkg/storage/legacysql"
)

// List

// Get

// Create

// TODO: use mapper?
func actionSet(resource string, level string) (string, error) {
	level = strings.ToLower(level)
	if !validLevels[level] {
		return "", fmt.Errorf("invalid permission level (%s): %w", level, errInvalidSpec)
	}
	return fmt.Sprintf("%s:%s", resource, level), nil
}

// TODO: use mapper?
func scope(resource string, name string) string {
	return fmt.Sprintf("%s:uid:%s", resource, name)
}

// createManagedRoleAndAssign creates a new managed role and assigns it to the given user/team/service account/basic role
func (s *ResourcePermSqlBackend) createManagedRoleAndAssign(ctx context.Context, tx *session.SessionTx, dbHelper *legacysql.LegacyDatabaseHelper, orgID int64, assignment grant) (int64, error) {
	// Create the managed role
	roleUID := accesscontrol.PrefixedRoleUID(fmt.Sprintf("%s:org:%v", assignment.RoleName, orgID))
	insertRoleQuery, args, err := buildInsertRoleQuery(dbHelper, orgID, roleUID, assignment.RoleName)
	if err != nil {
		return 0, err
	}

	_, err = tx.Exec(ctx, insertRoleQuery, args...)
	if err != nil {
		return 0, fmt.Errorf("executing insert role query: %w", err)
	}

	var roleID int64
	idQuery := fmt.Sprintf("SELECT id FROM %s WHERE org_id = ? AND name = ?", dbHelper.Table("role"))
	err = tx.Get(ctx, &roleID, idQuery, orgID, assignment.RoleName)
	if err != nil {
		return 0, fmt.Errorf("retrieving id of created role: %w", err)
	}

	assignQuery, args, err := buildInsertAssignmentQuery(dbHelper, orgID, roleID, assignment)
	if err != nil {
		return 0, err
	}
	_, err = tx.Exec(ctx, assignQuery, args...)
	if err != nil {
		return 0, fmt.Errorf("executing insert assignment query: %w", err)
	}

	return roleID, nil
}

// storeRbacAssignment ensures that a role exists for the given assignment, creates and assigns it if it doesn't
// and then ensures that the role has the correct permission for the given scope
func (s *ResourcePermSqlBackend) storeRbacAssignment(ctx context.Context, dbHelper *legacysql.LegacyDatabaseHelper, tx *session.SessionTx, orgID int64, assignment grant) error {
	// Check if role already exists
	var roleID int64
	query := fmt.Sprintf("SELECT id FROM %s WHERE org_id = ? AND name = ?", dbHelper.Table("role"))
	err := tx.Get(ctx, &roleID, query, orgID, assignment.RoleName)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("checking for existing role: %w", err)
	}

	// Role doesn't exist, create it
	if roleID == 0 {
		roleID, err = s.createManagedRoleAndAssign(ctx, tx, dbHelper, orgID, assignment)
		if err != nil {
			return err
		}
	}

	// Add the new permission
	insertPermQuery, args, err := buildInsertPermissionQuery(dbHelper, roleID, assignment.permission())
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, insertPermQuery, args...)
	if err != nil {
		s.logger.Error("inserting new permission", "roleID", roleID, "scope", assignment.Scope, "error", err)
		return fmt.Errorf("could not insert role permission")
	}

	return nil
}

// buildRbacAssignments builds the list of grants (role assignments and permissions) for a given ResourcePermission spec
// It resolves user/team/service account UIDs to internal IDs for the role name and assignee ID
func (s *ResourcePermSqlBackend) buildRbacAssignments(ctx context.Context, ns types.NamespaceInfo, v0ResourcePerm *v0alpha1.ResourcePermission, rbacScope string) ([]grant, error) {
	assignments := make([]grant, 0, len(v0ResourcePerm.Spec.Permissions))

	for _, perm := range v0ResourcePerm.Spec.Permissions {
		rbacActionSet, err := actionSet(v0ResourcePerm.Spec.Resource.Resource, perm.Verb)
		if err != nil {
			return nil, err
		}

		switch perm.Kind {
		case v0alpha1.ResourcePermissionSpecPermissionKindUser:
			userID, err := s.identityStore.GetUserInternalID(ctx, ns, legacy.GetUserInternalIDQuery{
				UID:   perm.Name,
				OrgID: ns.OrgID,
			})
			if err != nil && !strings.Contains(err.Error(), "not found") {
				return nil, fmt.Errorf("resolving user %q to internal ID: %w", perm.Name, err)
			}
			if userID == nil {
				return nil, fmt.Errorf("user %q not found: %w", perm.Name, errInvalidSpec)
			}
			assignments = append(assignments, grant{
				RoleName:         fmt.Sprintf("managed:users:%d:permissions", userID.ID),
				AssignmentTable:  "user_role",
				AssignmentColumn: "user_id",
				AssigneeID:       fmt.Sprintf("%d", userID.ID),
				Action:           rbacActionSet,
				Scope:            rbacScope,
			})
		case v0alpha1.ResourcePermissionSpecPermissionKindTeam:
			teamID, err := s.identityStore.GetTeamInternalID(ctx, ns, legacy.GetTeamInternalIDQuery{
				UID:   perm.Name,
				OrgID: ns.OrgID,
			})
			if err != nil && !strings.Contains(err.Error(), "not found") {
				return nil, fmt.Errorf("resolving team %q to internal ID: %w", perm.Name, err)
			}
			if teamID == nil {
				return nil, fmt.Errorf("team %q not found: %w", perm.Name, errInvalidSpec)
			}
			assignments = append(assignments, grant{
				RoleName:         fmt.Sprintf("managed:teams:%d:permissions", teamID.ID),
				AssignmentTable:  "team_role",
				AssignmentColumn: "team_id",
				AssigneeID:       fmt.Sprintf("%d", teamID.ID),
				Action:           rbacActionSet,
				Scope:            rbacScope,
			})
		case v0alpha1.ResourcePermissionSpecPermissionKindServiceAccount:
			saID, err := s.identityStore.GetServiceAccountInternalID(ctx, ns, legacy.GetServiceAccountInternalIDQuery{
				UID:   perm.Name,
				OrgID: ns.OrgID,
			})
			if err != nil && !strings.Contains(err.Error(), "not found") {
				return nil, fmt.Errorf("resolving service account %q to internal ID: %w", perm.Name, err)
			}
			if saID == nil {
				return nil, fmt.Errorf("service account %q not found: %w", perm.Name, errInvalidSpec)
			}
			assignments = append(assignments, grant{
				RoleName:         fmt.Sprintf("managed:users:%d:permissions", saID.ID),
				AssignmentTable:  "user_role",
				AssignmentColumn: "user_id",
				AssigneeID:       fmt.Sprintf("%d", saID.ID),
				Action:           rbacActionSet,
				Scope:            rbacScope,
			})
		case v0alpha1.ResourcePermissionSpecPermissionKindBasicRole:
			assignments = append(assignments, grant{
				RoleName:         fmt.Sprintf("managed:builtins:%s:permissions", perm.Name),
				AssignmentTable:  "builtin_role",
				AssignmentColumn: "role",
				AssigneeID:       perm.Name,
				Action:           rbacActionSet,
				Scope:            rbacScope,
			})
		default:
			return nil, fmt.Errorf("unknown permission kind: %q: %w", perm.Kind, errInvalidSpec)
		}
	}

	return assignments, nil
}

func (s *ResourcePermSqlBackend) createResourcePermission(ctx context.Context, dbHelper *legacysql.LegacyDatabaseHelper, ns types.NamespaceInfo, v0ResourcePerm *v0alpha1.ResourcePermission) (int64, error) {
	if v0ResourcePerm == nil {
		return 0, fmt.Errorf("resource permission cannot be nil")
	}

	if len(v0ResourcePerm.Spec.Permissions) == 0 {
		return 0, fmt.Errorf("resource permission must have at least one permission: %w", errInvalidSpec)
	}

	rbacScope := scope(v0ResourcePerm.Spec.Resource.Resource, v0ResourcePerm.Spec.Resource.Name)

	assignments, err := s.buildRbacAssignments(ctx, ns, v0ResourcePerm, rbacScope)
	if err != nil {
		return 0, err
	}

	err = dbHelper.DB.GetSqlxSession().WithTransaction(ctx, func(tx *session.SessionTx) error {
		for _, assignment := range assignments {
			err := s.storeRbacAssignment(ctx, dbHelper, tx, ns.OrgID, assignment)
			if err != nil {
				return err
			}
		}

		return nil
	})

	if err != nil {
		return 0, err
	}

	// Return a timestamp as resource version
	return timeNow().UnixMilli(), nil
}

// Update

// Delete
