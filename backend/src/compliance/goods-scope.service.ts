import type { CommodityLineItem, ScopeValidationResult, RiskSeverity } from './types';

export class GoodsScopeService {
  /**
   * Evaluates line items against authorized scope (PO, LC, customer declared trade profile).
   */
  validateScope(params: {
    goods: CommodityLineItem[];
    declaredScope?: string;
    relatedPoNumber?: string;
    relatedLcNumber?: string;
    customerDeclaredBusiness?: string;
  }): ScopeValidationResult {
    const declaredScope = params.declaredScope || params.customerDeclaredBusiness || 'Standard Commercial Trade';
    const authorizedGoods: CommodityLineItem[] = [];
    const outOfScopeGoods: CommodityLineItem[] = [];
    const mismatchDetails: string[] = [];

    const normScope = declaredScope.toLowerCase();

    for (const item of params.goods) {
      const desc = item.productDescription.toLowerCase();
      const cat = (item.productCategory || '').toLowerCase();

      // Check if product conflicts with declared trade scope
      const isOutOfScope = this.checkIfOutOfScope(desc, cat, normScope);

      if (isOutOfScope) {
        item.isAuthorizedScope = false;
        item.scopeAuthorizationNote = `Item "${item.productDescription}" falls outside declared authorized transaction scope ("${declaredScope}"). Requires customer trade authorization review.`;
        item.riskSeverity = item.riskSeverity === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
        outOfScopeGoods.push(item);
        mismatchDetails.push(
          `Line ${item.itemNumber}: "${item.productDescription}" (${item.quantity} ${item.unitOfMeasure}) is out-of-scope for declared business/scope "${declaredScope}".`,
        );
      } else {
        item.isAuthorizedScope = true;
        item.scopeAuthorizationNote = 'Consistent with authorized transaction scope.';
        authorizedGoods.push(item);
      }
    }

    return {
      declaredAuthorizedScope: declaredScope,
      authorizedGoods,
      outOfScopeGoods,
      hasOutOfScopeGoods: outOfScopeGoods.length > 0,
      mismatchDetails,
    };
  }

  private checkIfOutOfScope(productDesc: string, category: string, scope: string): boolean {
    if (!scope || scope === 'not found' || scope === 'standard commercial trade') {
      return false;
    }

    // Textiles / Garments scope vs Machinery / Tech / Footwear
    if (scope.includes('textile') || scope.includes('garment') || scope.includes('shirt') || scope.includes('cotton') || scope.includes('apparel')) {
      const isGarment = productDesc.includes('shirt') || productDesc.includes('cotton') || productDesc.includes('pant') ||
                        productDesc.includes('fabric') || productDesc.includes('garment') || productDesc.includes('yarn') ||
                        productDesc.includes('textile') || productDesc.includes('cloth') || productDesc.includes('dress');
      if (!isGarment) {
        // If it's shoes, laser equipment, chemicals, electronics, heavy machinery
        if (productDesc.includes('shoe') || productDesc.includes('footwear') || productDesc.includes('laser') ||
            productDesc.includes('machinery') || productDesc.includes('electronic') || productDesc.includes('chemical') ||
            productDesc.includes('hardware') || productDesc.includes('drone') || productDesc.includes('equipment')) {
          return true;
        }
      }
    }

    // Electronics scope vs Agricultural / Chemical
    if (scope.includes('electronic') || scope.includes('computer') || scope.includes('semiconductor')) {
      if (productDesc.includes('grain') || productDesc.includes('fertilizer') || productDesc.includes('timber') || productDesc.includes('apparel')) {
        return true;
      }
    }

    // Food / Agri scope vs Industrial Machinery
    if (scope.includes('agriculture') || scope.includes('food') || scope.includes('grain') || scope.includes('wheat')) {
      if (productDesc.includes('machinery') || productDesc.includes('laser') || productDesc.includes('electronic') || productDesc.includes('weapon')) {
        return true;
      }
    }

    return false;
  }
}
