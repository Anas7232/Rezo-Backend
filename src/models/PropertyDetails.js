// property.search.model.js
import { Schema, model } from "mongoose";

const propertySearchSchema = new Schema(
  {
    propertyId: {
      type: String,
      required: true,
      unique: true,
    },
    // Denormalized core fields for search
    title: { type: String, index: "text" },
    description: { type: String, index: "text" },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    // Search optimization
    searchTags: { type: [String], index: true },
    searchBoost: { type: Number, default: 0 },
    // Presentation layer cache
    featuredPhotos: [String],
    quickStats: {
      rating: Number,
      reviewCount: Number,
      bookedCount: Number,
    },
  },
  {
    timestamps: true,
    autoIndex: true,
  }
);

// Geospatial index for location searches
propertySearchSchema.index({ location: "2dsphere" });

export default model("PropertySearch", propertySearchSchema);
