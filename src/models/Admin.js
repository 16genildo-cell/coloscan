'use strict';
const { Schema, model } = require('mongoose');

const AdminSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

module.exports = model('Admin', AdminSchema);
