import { isArray, pick, reduce } from 'lodash';

import { Label } from '../matchers/types';
import { LabelsMatch, matchLabels } from '../matchers/utils';

import { Route } from './types';

export const INHERITABLE_KEYS = ['receiver', 'group_by', 'group_wait', 'group_interval', 'repeat_interval'] as const;
export type InheritableKeys = typeof INHERITABLE_KEYS;
export type InheritableProperties = Pick<Route, InheritableKeys[number]>;

export interface RouteMatchResult<T extends Route> {
  route: T;
  labelsMatch: LabelsMatch;
}

// Normalization should have happened earlier in the code
export function findMatchingRoutes<T extends Route>(route: T, labels: Label[]): Array<RouteMatchResult<T>> {
  let childMatches: Array<RouteMatchResult<T>> = [];

  // If the current node is not a match, return nothing
  const matchResult = matchLabels(route.matchers ?? [], labels);
  if (!matchResult.matches) {
    return [];
  }

  // If the current node matches, recurse through child nodes
  if (route.routes) {
    for (const child of route.routes) {
      const matchingChildren = findMatchingRoutes(child, labels);
      // TODO how do I solve this typescript thingy? It looks correct to me /shrug
      // @ts-ignore
      childMatches = childMatches.concat(matchingChildren);
      // we have matching children and we don't want to continue, so break here
      if (matchingChildren.length && !child.continue) {
        break;
      }
    }
  }

  // If no child nodes were matches, the current node itself is a match.
  if (childMatches.length === 0) {
    childMatches.push({ route, labelsMatch: matchResult.labelsMatch });
  }

  return childMatches;
}

/**
 * This function will compute the full tree with inherited properties – this is mostly used for search and filtering
 */
export function computeInheritedTree<T extends Route>(parent: T): T {
  return {
    ...parent,
    routes: parent.routes?.map((child) => {
      const inheritedProperties = getInheritedProperties(parent, child);

      return computeInheritedTree({
        ...child,
        ...inheritedProperties,
      });
    }),
  };
}

// inherited properties are config properties that exist on the parent route (or its inherited properties) but not on the child route
function getInheritedProperties(
  parentRoute: Route,
  childRoute: Route,
  propertiesParentInherited?: InheritableProperties
): InheritableProperties {
  const propsFromParent: InheritableProperties = pick(parentRoute, INHERITABLE_KEYS);
  const inheritableProperties: InheritableProperties = {
    ...propsFromParent,
    ...propertiesParentInherited,
  };

  const inherited = reduce(
    inheritableProperties,
    (inheritedProperties: InheritableProperties, parentValue, property) => {
      const parentHasValue = parentValue != null;

      const inheritableValues = [undefined, '', null];
      // @ts-ignore
      const childIsInheriting = inheritableValues.some((value) => childRoute[property] === value);
      const inheritFromValue = childIsInheriting && parentHasValue;

      const inheritEmptyGroupByFromParent =
        property === 'group_by' &&
        parentHasValue &&
        isArray(childRoute[property]) &&
        childRoute[property]?.length === 0;

      const inheritFromParent = inheritFromValue || inheritEmptyGroupByFromParent;

      if (inheritFromParent) {
        // @ts-ignore
        inheritedProperties[property] = parentValue;
      }

      return inheritedProperties;
    },
    {}
  );

  return inherited;
}
