// src/utils/geospatial.js
import { InvalidInputError } from "./apiError.js";

/**
 * Geospatial Utilities for Property Management System
 *
 * Features:
 * - GeoJSON creation and validation
 * - Distance calculations
 * - Bounding box operations
 * - Coordinate validation
 * - Spatial indexing helpers
 */

// Default SRID (Spatial Reference System Identifier)
const DEFAULT_SRID = 4326; // WGS84

export const geoJSON = {
  /**
   * Create GeoJSON Point from coordinates
   * @param {number} lat - Latitude (-90 to 90)
   * @param {number} lng - Longitude (-180 to 180)
   * @returns {Object} GeoJSON Point feature
   */
  createPoint(lat, lng) {
    this.validateCoordinates(lat, lng);
    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lng, lat],
      },
      properties: {},
    };
  },

  /**
   * Validate geographic coordinates
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @throws {InvalidInputError} If coordinates are invalid
   */
  validateCoordinates(lat, lng) {
    if (isNaN(lat) || isNaN(lng)) {
      throw new InvalidInputError("Coordinates must be numbers");
    }

    if (lat < -90 || lat > 90) {
      throw new InvalidInputError(
        "Latitude must be between -90 and 90 degrees"
      );
    }

    if (lng < -180 || lng > 180) {
      throw new InvalidInputError(
        "Longitude must be between -180 and 180 degrees"
      );
    }
  },

  /**
   * Calculate distance between two points in meters (Haversine formula)
   * @param {Object} point1 - { lat, lng }
   * @param {Object} point2 - { lat, lng }
   * @returns {number} Distance in meters
   */
  calculateDistance(point1, point2) {
    this.validateCoordinates(point1.lat, point1.lng);
    this.validateCoordinates(point2.lat, point2.lng);

    const R = 6371e3; // Earth radius in meters
    const φ1 = (point1.lat * Math.PI) / 180;
    const φ2 = (point2.lat * Math.PI) / 180;
    const Δφ = ((point2.lat - point1.lat) * Math.PI) / 180;
    const Δλ = ((point2.lng - point1.lng) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  },

  /**
   * Create a bounding box around a point
   * @param {Object} center - { lat, lng }
   * @param {number} radius - Radius in meters
   * @returns {Object} Bounding box coordinates { minLat, maxLat, minLng, maxLng }
   */
  createBoundingBox(center, radius) {
    this.validateCoordinates(center.lat, center.lng);

    const earthRadius = 6378137; // Earth's radius in meters (WGS84)
    const latDiff = (radius / earthRadius) * (180 / Math.PI);
    const lngDiff =
      (radius / (earthRadius * Math.cos((Math.PI * center.lat) / 180))) *
      (180 / Math.PI);

    return {
      minLat: center.lat - latDiff,
      maxLat: center.lat + latDiff,
      minLng: center.lng - lngDiff,
      maxLng: center.lng + lngDiff,
    };
  },

  /**
   * Convert to PostgreSQL geography type
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {number} srid - Spatial reference ID (default: 4326)
   * @returns {Object} Prisma geography type
   */
  toPostGIS(lat, lng, srid = DEFAULT_SRID) {
    this.validateCoordinates(lat, lng);
    return {
      type: "Point",
      coordinates: [lng, lat],
      crs: { type: "name", properties: { name: `EPSG:${srid}` } },
    };
  },

  /**
   * Format coordinates for MongoDB 2dsphere index
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @returns {Array} [longitude, latitude] array
   */
  toMongoDB(lat, lng) {
    this.validateCoordinates(lat, lng);
    return [lng, lat];
  },

  /**
   * Check if a point is within a polygon
   * @param {Object} point - { lat, lng }
   * @param {Array} polygon - Array of { lat, lng } points
   * @returns {boolean} True if point is inside polygon
   */
  isPointInPolygon(point, polygon) {
    this.validateCoordinates(point.lat, point.lng);
    polygon.forEach((p) => this.validateCoordinates(p.lat, p.lng));

    // Ray casting algorithm
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng,
        yi = polygon[i].lat;
      const xj = polygon[j].lng,
        yj = polygon[j].lat;

      const intersect =
        yi > point.lat !== yj > point.lat &&
        point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }

    return inside;
  },

  /**
   * Generate GeoJSON for database queries
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @returns {Object} Prisma-compatible GeoJSON
   */
  forDatabase(lat, lng) {
    this.validateCoordinates(lat, lng);
    return {
      type: "Point",
      coordinates: [lng, lat],
      crs: { type: "name", properties: { name: "EPSG:4326" } },
    };
  },
};

/**
 * Helper functions for common geospatial operations
 */
export const spatialHelpers = {
  /**
   * Parse location from various input formats
   * @param {Object|string} input - Location input
   * @returns {Object} { lat, lng }
   */
  parseLocation(input) {
    if (typeof input === "string") {
      const [lat, lng] = input.split(",").map(parseFloat);
      return { lat, lng };
    }
    return input;
  },

  /**
   * Generate SQL fragment for distance calculation
   * @param {string} column - Geometry column name
   * @param {number} lat - Reference latitude
   * @param {number} lng - Reference longitude
   * @returns {string} SQL fragment
   */
  distanceSQL(column, lat, lng) {
    return `ST_Distance(${column}, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))`;
  },

  /**
   * Generate MongoDB $nearSphere query
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {number} maxDistance - Max distance in meters
   * @returns {Object} MongoDB query object
   */
  mongoNearQuery(lat, lng, maxDistance) {
    return {
      $nearSphere: {
        $geometry: {
          type: "Point",
          coordinates: [lng, lat],
        },
        $maxDistance: maxDistance,
      },
    };
  },
};

/**
 * Middleware for Express to validate and normalize location data
 */
export const locationMiddleware = (req, res, next) => {
  try {
    if (req.body.location) {
      const { lat, lng } = geoJSON.parseLocation(req.body.location);
      geoJSON.validateCoordinates(lat, lng);
      req.body.location = geoJSON.forDatabase(lat, lng);
    }
    next();
  } catch (error) {
    next(error);
  }
};

export default geoJSON;
