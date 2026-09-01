import { resolveCommissionerPruid } from "./provinceCatalog.js";
import { MapReleaseError } from "../map/canonicalReleaseStore.js";
import {
  getCurrentReleaseScopeIndex,
  resolveDguidRelationship,
  resolveFedRelationship,
} from "../map/releaseScopeIndex.js";

function commissionerScopeError(message, { statusCode = 500, code } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export function resolveCommissionerDguidContext(dguid, commissionerProfile) {
  const operatingPruid = resolveCommissionerPruid(commissionerProfile);
  if (!operatingPruid) {
    throw commissionerScopeError("Commissioner province registration is required.", {
      statusCode: 403,
      code: "MISSING_COMMISSIONER_PROVINCE",
    });
  }

  try {
    const release = getCurrentReleaseScopeIndex();
    const scope = resolveDguidRelationship(release, dguid, operatingPruid);
    return {
      operatingPruid,
      selectedArea: {
        ...scope.selectedArea,
        relationship: scope.relationship,
      },
      relationship: scope.relationship,
      inScopeNeighbors: scope.inScopeNeighbors,
    };
  } catch (error) {
    if (error instanceof MapReleaseError) {
      throw commissionerScopeError(error.publicMessage ?? error.message, {
        statusCode: error.statusCode ?? 404,
        code: error.code ?? "MAP_SCOPE_LOOKUP_FAILED",
      });
    }
    throw error;
  }
}

export function resolveCommissionerFedContext(fedNum, commissionerProfile) {
  const operatingPruid = resolveCommissionerPruid(commissionerProfile);
  if (!operatingPruid) {
    throw commissionerScopeError("Commissioner province registration is required.", {
      statusCode: 403,
      code: "MISSING_COMMISSIONER_PROVINCE",
    });
  }

  try {
    const release = getCurrentReleaseScopeIndex();
    const scope = resolveFedRelationship(release, fedNum, operatingPruid);
    return {
      operatingPruid,
      selectedFed: {
        ...scope.selectedFed,
        relationship: scope.relationship,
      },
      relationship: scope.relationship,
      inScopeNeighbors: scope.inScopeNeighbors,
    };
  } catch (error) {
    if (error instanceof MapReleaseError) {
      throw commissionerScopeError(error.publicMessage ?? error.message, {
        statusCode: error.statusCode ?? 404,
        code: error.code ?? "MAP_SCOPE_LOOKUP_FAILED",
      });
    }
    throw error;
  }
}
