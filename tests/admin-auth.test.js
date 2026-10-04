import test from "node:test";
import assert from "node:assert/strict";
import { usernameToAuthEmail } from "../src/js/admin-auth.js";

test("admin username is normalized and mapped to the configured auth domain", () => {
  assert.equal(usernameToAuthEmail("  Moosama.Admin  ", " Admin.Example "), "moosama.admin@admin.example");
});

test("email login accepts a syntactically valid email and normalizes case", () => {
  assert.equal(usernameToAuthEmail("  Admin@Example.COM ", "unused.example"), "admin@example.com");
});

test("invalid usernames and domains are rejected before contacting auth", () => {
  for (const username of ["", "two words", "user@", "@example.com", "a@b@example.com", "<script>"]) {
    assert.throws(() => usernameToAuthEmail(username, "admin.example"));
  }
  for (const domain of ["", "localhost", "bad domain", "https://admin.example"]) {
    assert.throws(() => usernameToAuthEmail("admin", domain));
  }
});
