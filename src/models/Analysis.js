'use strict';
const { Schema, model } = require('mongoose');

/**
 * Resultado de uma análise. A IMAGEM NUNCA É SALVA: é processada em memória
 * e descartada. `expiresAt` + rotina de limpeza implementam a política de retenção.
 */
const FeatureSchema = new Schema(
  { code: String, label: String, description: String },
  { _id: false },
);

const AnalysisSchema = new Schema(
  {
    device: { type: Schema.Types.ObjectId, ref: 'Device', required: true, index: true },
    status: { type: String, enum: ['processing', 'completed', 'inconclusive', 'failed'], required: true },
    inconclusive: { type: Boolean, default: false },
    features: { type: [FeatureSchema], default: [] },
    message: { type: String, default: '' },
    limitations: { type: [String], default: [] },
    modelVersion: String,
    consentVersion: { type: String, required: true },
    consentAt: { type: Date, required: true },
    // Apagado pela rotina de retenção (services/retention.js) após esta data.
    expiresAt: { type: Date, index: true },
  },
  { timestamps: true },
);

AnalysisSchema.methods.toApi = function toApi() {
  return {
    analysis_id: this._id.toString(),
    status: this.status,
    features: this.features.map((f) => ({
      code: f.code,
      label: f.label,
      ...(f.description ? { description: f.description } : {}),
    })),
    message: this.message,
    limitations: this.limitations,
    inconclusive: this.inconclusive,
    model_version: this.modelVersion || null,
    clinically_validated: false,
    recommend_medical_evaluation: false,
  };
};

module.exports = model('Analysis', AnalysisSchema);
