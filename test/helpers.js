'use strict';
const crypto = require('crypto');
const session = require('express-session');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

process.env.MONGODB_URI_TEST = process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/coloscan_test';

const config = {
  env: 'test',
  isProduction: false,
  port: 0,
  mongoUri: process.env.MONGODB_URI_TEST,
  sessionSecret: 'test-secret-test-secret-test-secret',
  encryptionKey: crypto.randomBytes(32),
  trustProxy: false,
};

async function setupDb() {
  if (mongoose.connection.readyState === 0) await mongoose.connect(config.mongoUri);
  await mongoose.connection.dropDatabase();
}

async function teardownDb() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

function buildApp(options = {}) {
  const { createApp } = require('../src/app');
  return createApp(config, { sessionStore: new session.MemoryStore(), ...options });
}

async function createAdmin(email = 'admin@teste.com', password = 'senha-forte-123') {
  const Admin = require('../src/models/Admin');
  await Admin.create({ email, passwordHash: await bcrypt.hash(password, 4) });
  return { email, password };
}

/** JPEG mínimo (cabeçalho válido) — o provedor é simulado nos testes. */
const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]);

module.exports = { config, setupDb, teardownDb, buildApp, createAdmin, fakeJpeg };
