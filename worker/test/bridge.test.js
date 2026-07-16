/**
 * Testes da ponte worker → atendente (bridge.js).
 * Rodar: npm test (dentro de worker/).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyInbound, classifyInterest, forwardToAttendant } from "../src/bridge.js";

const OPTOUT = ["sair", "parar", "pare", "cancelar", "stop"];

test("classifyInbound: vazio/só espaços → ignore", () => {
  assert.equal(classifyInbound("", OPTOUT), "ignore");
  assert.equal(classifyInbound("   ", OPTOUT), "ignore");
  assert.equal(classifyInbound(null, OPTOUT), "ignore");
});

test("classifyInbound: palavra de opt-out → optout (case-insensitive)", () => {
  assert.equal(classifyInbound("SAIR", OPTOUT), "optout");
  assert.equal(classifyInbound("parar agora", OPTOUT), "optout");
  assert.equal(classifyInbound("por favor cancelar", OPTOUT), "optout");
});

test("classifyInbound: opt-out casa palavra inteira, não substring", () => {
  // "pare" está na lista, mas "parede" não deve casar.
  assert.equal(classifyInbound("parede nova", OPTOUT), "forward");
  assert.equal(classifyInbound("saindo de casa", OPTOUT), "forward");
});

test("classifyInbound: qualquer outra palavra → forward", () => {
  assert.equal(classifyInbound("oi", OPTOUT), "forward");
  assert.equal(classifyInbound("sim", OPTOUT), "forward");
  assert.equal(classifyInbound("quanto custa?", OPTOUT), "forward");
});

test("classifyInterest: reconhece intenção comercial sem marcar saudações", () => {
  assert.equal(classifyInterest("quanto custa o plano?"), true);
  assert.equal(classifyInterest("quero uma demonstração"), true);
  assert.equal(classifyInterest("oi, tudo bem?"), false);
});

test("forwardToAttendant: sem URL configurada → false, sem chamar fetch", async () => {
  let called = false;
  const ok = await forwardToAttendant(
    { number_id: "x", phone: "5511", text: "oi" },
    { attendantUrl: "", fetch: () => { called = true; return { ok: true }; } }
  );
  assert.equal(ok, false);
  assert.equal(called, false);
});

test("forwardToAttendant: POST /inbound com payload, token e retorna true no 2xx", async () => {
  const seen = {};
  const fakeFetch = async (url, init) => {
    seen.url = url;
    seen.init = init;
    return { ok: true };
  };
  const ok = await forwardToAttendant(
    { number_id: "55119", phone: "5511988887777", jid: "5511988887777@s.whatsapp.net", text: "oi", name: "Ana" },
    { attendantUrl: "https://atendente.example", attendantToken: "seg", fetch: fakeFetch }
  );
  assert.equal(ok, true);
  assert.equal(seen.url, "https://atendente.example/inbound");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers["x-worker-token"], "seg");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.number_id, "55119");
  assert.equal(body.text, "oi");
  assert.equal(body.name, "Ana");
});

test("forwardToAttendant: erro de rede não lança, retorna false", async () => {
  const ok = await forwardToAttendant(
    { number_id: "x", phone: "5511", text: "oi" },
    { attendantUrl: "https://x.example", fetch: async () => { throw new Error("boom"); } }
  );
  assert.equal(ok, false);
});

test("forwardToAttendant: resposta não-2xx → false", async () => {
  const ok = await forwardToAttendant(
    { number_id: "x", phone: "5511", text: "oi" },
    { attendantUrl: "https://x.example", fetch: async () => ({ ok: false, status: 500 }) }
  );
  assert.equal(ok, false);
});
