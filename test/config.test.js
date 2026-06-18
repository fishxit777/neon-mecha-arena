import test from "node:test";
import assert from "node:assert/strict";
import { isOriginAllowed, isOriginAllowedForHost, loadConfig, requireAdminToken } from "../src/config.js";

test("loadConfig accepts configured and local origins", () => {
  const config = loadConfig({
    PORT: "4567",
    PUBLIC_ORIGIN: "https://game.example.com,https://live.example.com",
    ADMIN_TOKEN: "secret",
    NODE_ENV: "production"
  });

  assert.equal(config.port, 4567);
  assert.equal(isOriginAllowed("https://game.example.com", config), true);
  assert.equal(isOriginAllowed("https://live.example.com", config), true);
  assert.equal(isOriginAllowed("https://evil.example.com", config), false);
});

test("development mode accepts Cloudflare quick tunnel origins", () => {
  const config = loadConfig({
    PORT: "3000",
    PUBLIC_ORIGIN: "http://192.168.1.2:3000",
    NODE_ENV: "development"
  });

  assert.equal(isOriginAllowed("https://accessibility-buys-top-hardware.trycloudflare.com", config), true);
  assert.equal(isOriginAllowed("https://evil.example.com", config), false);
});

test("production mode accepts same-host deployed origins", () => {
  const config = loadConfig({
    PORT: "3000",
    PUBLIC_ORIGIN: "https://placeholder.onrender.com",
    NODE_ENV: "production"
  });

  assert.equal(isOriginAllowedForHost("https://actual-service.onrender.com", "actual-service.onrender.com", config), true);
  assert.equal(isOriginAllowedForHost("https://evil.example.com", "actual-service.onrender.com", config), false);
});

test("admin token must match exactly", () => {
  const config = loadConfig({ ADMIN_TOKEN: "abc123" });
  assert.equal(requireAdminToken("abc123", config), true);
  assert.equal(requireAdminToken("abc123 ", config), false);
  assert.equal(requireAdminToken("", config), false);
});

test("production disables the public test admin token when ADMIN_TOKEN is missing", () => {
  const config = loadConfig({ NODE_ENV: "production" });

  assert.equal(config.adminToken, "");
  assert.equal(requireAdminToken("change-me-to-a-32-character-random-token", config), false);
});
