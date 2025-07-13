import { Schema, model } from "mongoose";

const userPreferencesSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
    },
    savedSearches: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    favorites: {
      type: [String],
      default: [],
    },
    notificationSettings: {
      type: Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

export default model("UserPreferences", userPreferencesSchema);
