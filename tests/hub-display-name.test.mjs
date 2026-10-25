import assert from "node:assert/strict";
import { test } from "node:test";
import { accountDisplayName } from "../lib/hub-users/display-name.ts";

test("greets with the person's name first", () => {
  assert.equal(accountDisplayName({ firstName: "Ada", lastName: "Lovelace" }, "KalaClo", "info@kalaclo.com"), "Ada Lovelace");
});

test("falls back to the company, then to the e-mail address", () => {
  assert.equal(accountDisplayName({ firstName: "", lastName: " " }, "KalaClo", "info@kalaclo.com"), "KalaClo");
  assert.equal(accountDisplayName({ firstName: "", lastName: "" }, null, "info@kalaclo.com"), "info");
  assert.equal(accountDisplayName(null, "", ""), "Dein Konto");
});
