import mongoose, { model } from "mongoose";
const { Schema } = mongoose;
const userCacheSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    name: String,
    avatar: String,
    lastSeen: Date,
    status: String,
  },
  { timestamps: true }
);

export const UserCache = model("UserCache", userCacheSchema);
