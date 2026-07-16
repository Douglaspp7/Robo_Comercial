import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLeadAlert, isQuietHour } from '../src/lead-alerts.js';
test('horário silencioso funciona atravessando meia-noite', () => { assert.equal(isQuietHour(23,22,8),true); assert.equal(isQuietHour(7,22,8),true); assert.equal(isQuietHour(12,22,8),false); });
test('alerta inclui contexto e link direto', () => { const text=buildLeadAlert({level:'hot',name:'Clínica X',reason:'pediu demonstração',search_query:'clínica estética',phone:'5511999999999'}); assert.match(text,/lead quente/); assert.match(text,/Clínica X/); assert.match(text,/wa\.me\/5511999999999/); });
