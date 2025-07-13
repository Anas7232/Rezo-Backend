// utils/pricing.js
export class PricingService {
  /**
   * Calculate dynamic price for a given availability slot
   * @param {Object} availability - Availability slot
   * @param {Date} availability.startDate - Start date of availability
   * @param {Date} availability.endDate - End date of availability
   * @param {number} availability.basePrice - Base price for the property
   * @param {Object} property - Property details
   * @returns {number} - Final calculated price
   */
  static calculateDynamicPrice(availability, property) {
    // console.log("Calculating price for:", availability, property);

    if (
      !availability ||
      typeof availability !== "object" ||
      !availability.startDate ||
      !availability.endDate
    ) {
      console.error("Invalid availability object:", availability);
      return 0; // Return a safe default price
    }

    const basePrice = availability.basePrice;
    const stayDuration = this.calculateStayDuration(availability);

    let finalPrice = basePrice;
    finalPrice *= this.getSeasonalMultiplier(new Date(availability.startDate));
    finalPrice *= this.getDemandMultiplier(new Date(availability.startDate));
    finalPrice = this.applyLengthOfStayDiscount(finalPrice, stayDuration);
    finalPrice = this.applyPromotionalDiscount(
      finalPrice,
      property?.promotions || []
    );

    return Math.max(finalPrice, property?.minPrice || basePrice * 0.5);
  }

  /**
   * Calculate seasonal multiplier based on date
   * @param {Date} date - Target date
   * @returns {number} - Seasonal multiplier (1.0 = base price)
   */

  static getSeasonalMultiplier(date) {
    if (!date || isNaN(new Date(date).getTime())) {
      console.error("Invalid date in getSeasonalMultiplier", date);
      return 1;
    }
    date = new Date(date);
    const month = date.getMonth() + 1;
    if (month >= 6 && month <= 8) return 1.5;
    if ((month >= 4 && month <= 5) || (month >= 9 && month <= 10)) return 1.2;
    return 0.8;
  }

  /**
   * Calculate demand multiplier based on booking trends
   * @param {Date} date - Target date
   * @returns {number} - Demand multiplier (1.0 = base price)
   */

  static getDemandMultiplier(date) {
    if (!date || isNaN(new Date(date).getTime())) {
      console.error("Invalid date in getDemandMultiplier", date);
      return 1;
    }
    date = new Date(date);
    return date.getDay() === 5 || date.getDay() === 6 ? 1.2 : 1.0;
  }

  /**
   * Apply length-of-stay discounts
   * @param {number} price - Current price
   * @param {number} duration - Stay duration in days
   * @returns {number} - Price after length-of-stay discount
   */
  static applyLengthOfStayDiscount(price, duration) {
    // Example discounts:
    // 7+ days: 10% discount
    // 14+ days: 20% discount
    // 30+ days: 30% discount
    if (duration >= 30) return price * 0.7;
    if (duration >= 14) return price * 0.8;
    if (duration >= 7) return price * 0.9;
    return price;
  }

  /**
   * Apply promotional discounts
   * @param {number} price - Current price
   * @param {Array} promotions - Active promotions
   * @returns {number} - Price after promotional discounts
   */
  static applyPromotionalDiscount(price, promotions = []) {
    if (!Array.isArray(promotions)) {
      console.error("Invalid promotions array:", promotions);
      return price; // Return original price if promotions is not an array
    }

    return promotions.reduce((currentPrice, promotion) => {
      if (
        promotion &&
        typeof promotion.discount === "number" &&
        this.isPromotionValid(promotion)
      ) {
        return currentPrice * (1 - promotion.discount);
      }
      return currentPrice;
    }, price);
  }

  /**
   * Check if promotion is valid
   * @param {Object} promotion - Promotion details
   * @returns {boolean} - True if promotion is valid
   */
  static isPromotionValid(promotion) {
    const now = new Date();
    return (
      promotion.active &&
      new Date(promotion.startDate) <= now &&
      new Date(promotion.endDate) >= now
    );
  }

  /**
   * Calculate stay duration in days
   * @param {Object} availability - Availability slot
   * @returns {number} - Duration in days
   */
  static calculateStayDuration(availability) {
    const timeDiff =
      new Date(availability.endDate) - new Date(availability.startDate);
    return Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
  }
}
