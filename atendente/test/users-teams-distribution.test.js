/**
 * PR 2 — Testes de Equipes, Usuários, Permissões e Distribuição Round-Robin.
 *
 * Importa apenas db.js e auth.js (que não puxam pdfjs-dist).
 * A lógica de distributeContact é replicada inline (como handoff.test.js faz
 * com a state-machine) para evitar importar webhook.js que carrega a cadeia
 * completa de IA e knowledge, incluindo pdfjs-dist (incompatível com Node puro).
 *
 * Run: node --test test/users-teams-distribution.test.js
 */
import './_setup.js';
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  db,
  tenantQueries,
  contactQueries,
  userQueries,
  teamQueries,
  teamUserQueries,
  userInvitationQueries,
  sessionQueries,
} from '../src/db.js';
import { login, hashPassword } from '../src/auth.js';

// ── Inline distributeContact (mirror webhook.js sem imports pesados) ──────────
function distributeContact(tenantId, contactId) {
  const contact = contactQueries.byId.get(contactId);
  if (!contact) return null;

  // Se já possui atendente, não redistribui
  if (contact.assigned_user_id) {
    return contact.assigned_user_id;
  }

  let assignedUser = null;

  // 1. Tenta distribuir para a equipe atual
  if (contact.assigned_team_id) {
    assignedUser = userQueries.getAvailableRoundRobinForTeam.get(contact.assigned_team_id);
  }

  // 2. Se não conseguiu (ou não tinha equipe), tenta distribuir globalmente
  if (!assignedUser) {
    assignedUser = userQueries.getAvailableRoundRobin.get(tenantId);
  }

  if (assignedUser) {
    contactQueries.assign.run(assignedUser.id, contact.assigned_team_id || null, contact.id, tenantId);

    const sysMsg = `Conversa atribuída a ${assignedUser.name} via rodízio automático`;
    db.prepare(`
      INSERT INTO messages (contact_id, role, content, created_at)
      VALUES (?, 'system', ?, datetime('now'))
    `).run(contact.id, sysMsg);

    return assignedUser.id;
  }

  return null;
}

describe('PR 2 — Equipes, Usuários, Permissões e Distribuição', () => {
  const tenantId = 'tnt_test_rbac_123';
  const adminUserId = 'usr_admin_123';
  const agentUserId = 'usr_agent_456';

  before(() => {
    db.prepare(`
      INSERT OR REPLACE INTO tenants (id, email, password_hash, business_name, routing_slug, active, plan, subscription_status)
      VALUES (?, ?, ?, ?, ?, 1, 'elite', 'active')
    `).run(tenantId, 'dono_pr2@teste.com', hashPassword('dono123'), 'Loja PR2', 'lojapr2');
  });

  beforeEach(() => {
    db.prepare(`DELETE FROM user_invitations`).run();
    db.prepare(`DELETE FROM team_users`).run();
    db.prepare(`DELETE FROM teams`).run();
    db.prepare(`DELETE FROM users`).run();
    db.prepare(`DELETE FROM sessions`).run();
    db.prepare(`DELETE FROM contacts`).run();
    db.prepare(`DELETE FROM messages`).run();
  });

  // ── Autenticação e RBAC ────────────────────────────────────────────────────

  test('Deve autenticar sub-usuários (admin e agent) e vincular user_id na sessão', () => {
    userQueries.create.run({
      id: adminUserId,
      tenant_id: tenantId,
      email: 'admin@teste.com',
      password_hash: hashPassword('admin123'),
      name: 'Admin Teste',
      role: 'admin',
      active: 1,
      available: 1,
    });

    userQueries.create.run({
      id: agentUserId,
      tenant_id: tenantId,
      email: 'agent@teste.com',
      password_hash: hashPassword('agent123'),
      name: 'Agent Teste',
      role: 'agent',
      active: 1,
      available: 1,
    });

    // Login do Admin
    const adminToken = login('admin@teste.com', 'admin123');
    assert.ok(adminToken, 'Deve gerar session token para o admin');
    const adminSession = sessionQueries.byToken.get(adminToken);
    assert.ok(adminSession);
    assert.equal(adminSession.tenant_id, tenantId);
    assert.equal(adminSession.user_id, adminUserId);

    // Login do Agent
    const agentToken = login('agent@teste.com', 'agent123');
    assert.ok(agentToken, 'Deve gerar session token para o agent');
    const agentSession = sessionQueries.byToken.get(agentToken);
    assert.ok(agentSession);
    assert.equal(agentSession.user_id, agentUserId);

    // Senha incorreta
    assert.equal(login('agent@teste.com', 'senhaerrada'), null);

    // Usuário inativo
    userQueries.toggleActive.run(0, agentUserId, tenantId);
    assert.equal(login('agent@teste.com', 'agent123'), null);
  });

  // ── Convites ───────────────────────────────────────────────────────────────

  test('Deve gerar, listar e aceitar convites de novos usuários', () => {
    const inviteToken = 'token_convite_seguro_999';
    const expiresAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

    userInvitationQueries.create.run({
      id: 'inv_123',
      tenant_id: tenantId,
      email: 'novo_atendente@teste.com',
      role: 'agent',
      token: inviteToken,
      expires_at: expiresAt,
    });

    const invites = userInvitationQueries.listByTenant.all(tenantId);
    assert.equal(invites.length, 1);
    assert.equal(invites[0].email, 'novo_atendente@teste.com');
    assert.equal(invites[0].role, 'agent');

    const invite = userInvitationQueries.byToken.get(inviteToken);
    assert.ok(invite);

    const newUserId = 'usr_novo_atendente';
    userQueries.create.run({
      id: newUserId,
      tenant_id: invite.tenant_id,
      email: invite.email,
      password_hash: hashPassword('novasenha123'),
      name: 'Novo Atendente',
      role: invite.role,
      active: 1,
      available: 1,
    });
    userInvitationQueries.delete.run(invite.id);

    assert.equal(userInvitationQueries.byToken.get(inviteToken), undefined);
    const createdUser = userQueries.byId.get(newUserId);
    assert.ok(createdUser);
    assert.equal(createdUser.email, 'novo_atendente@teste.com');
    assert.equal(createdUser.role, 'agent');

    // Deve conseguir logar
    const token = login('novo_atendente@teste.com', 'novasenha123');
    assert.ok(token);
  });

  // ── Equipes e Membros ──────────────────────────────────────────────────────

  test('Deve gerenciar equipes e associar/desassociar membros', () => {
    const teamId = 'team_comercial_123';

    teamQueries.create.run({
      id: teamId,
      tenant_id: tenantId,
      name: 'Comercial',
      description: 'Equipe de vendas e pós-venda',
    });

    const teams = teamQueries.listByTenant.all(tenantId);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'Comercial');

    const user1Id = 'usr_team_1';
    const user2Id = 'usr_team_2';

    for (const [id, email, name] of [[user1Id, 'tm1@t.com', 'Membro 1'], [user2Id, 'tm2@t.com', 'Membro 2']]) {
      userQueries.create.run({ id, tenant_id: tenantId, email, password_hash: 'h', name, role: 'agent', active: 1, available: 1 });
    }

    teamUserQueries.add.run(teamId, user1Id);
    teamUserQueries.add.run(teamId, user2Id);

    const members = teamUserQueries.listMembers.all(teamId);
    assert.equal(members.length, 2);

    teamUserQueries.remove.run(teamId, user2Id);
    assert.equal(teamUserQueries.listMembers.all(teamId).length, 1);
    assert.equal(teamUserQueries.listMembers.all(teamId)[0].id, user1Id);

    // listUserTeams deve mostrar equipes de um usuário
    const userTeams = teamUserQueries.listUserTeams.all(user1Id);
    assert.equal(userTeams.length, 1);
    assert.equal(userTeams[0].id, teamId);
  });

  // ── Distribuição Round-Robin ───────────────────────────────────────────────

  test('Deve distribuir conversas via Round-Robin entre atendentes disponíveis', () => {
    const agents = [
      { id: 'usr_rr_1', email: 'rr1@t.com', name: 'Agente RR 1' },
      { id: 'usr_rr_2', email: 'rr2@t.com', name: 'Agente RR 2' },
      { id: 'usr_rr_3', email: 'rr3@t.com', name: 'Agente RR 3' },
    ];

    for (const a of agents) {
      userQueries.create.run({ id: a.id, tenant_id: tenantId, email: a.email, password_hash: 'h', name: a.name, role: 'agent', active: 1, available: 1 });
    }

    // Cria 3 contatos
    const contactIds = [];
    for (let i = 0; i < 3; i++) {
      const c = db.prepare(`INSERT INTO contacts (tenant_id, wa_phone, name) VALUES (?, ?, ?)`).run(tenantId, `551198880${i}`, `Cliente ${i}`);
      contactIds.push(c.lastInsertRowid);
    }

    // Distribui sequencialmente — com 0 carga, cada agente recebe 1
    const assigned = contactIds.map(id => distributeContact(tenantId, id));
    assert.equal(assigned.filter(Boolean).length, 3, 'Todos devem ser atribuídos');

    // Cada agente diferente (round-robin com 0 carga distribui uniformemente)
    const uniqueAssigned = new Set(assigned);
    assert.equal(uniqueAssigned.size, 3, 'Todos 3 agentes devem ter sido usados');
  });

  test('Round-Robin pula atendentes indisponíveis (available = 0)', () => {
    userQueries.create.run({ id: 'usr_av_1', tenant_id: tenantId, email: 'av1@t.com', password_hash: 'h', name: 'Disponível 1', role: 'agent', active: 1, available: 1 });
    userQueries.create.run({ id: 'usr_av_2', tenant_id: tenantId, email: 'av2@t.com', password_hash: 'h', name: 'Indisponível', role: 'agent', active: 1, available: 0 });
    userQueries.create.run({ id: 'usr_av_3', tenant_id: tenantId, email: 'av3@t.com', password_hash: 'h', name: 'Disponível 2', role: 'agent', active: 1, available: 1 });

    const c = db.prepare(`INSERT INTO contacts (tenant_id, wa_phone, name) VALUES (?, ?, ?)`).run(tenantId, '5511900001', 'Cliente X');
    const result = distributeContact(tenantId, c.lastInsertRowid);

    assert.ok(result);
    assert.notEqual(result, 'usr_av_2', 'Agente offline não deve receber chat');
  });

  test('Round-Robin não redistribui contato já atribuído', () => {
    userQueries.create.run({ id: 'usr_nr_1', tenant_id: tenantId, email: 'nr1@t.com', password_hash: 'h', name: 'Agent NR', role: 'agent', active: 1, available: 1 });
    userQueries.create.run({ id: 'usr_nr_2', tenant_id: tenantId, email: 'nr2@t.com', password_hash: 'h', name: 'Agent NR 2', role: 'agent', active: 1, available: 1 });

    const c = db.prepare(`INSERT INTO contacts (tenant_id, wa_phone, name) VALUES (?, ?, ?)`).run(tenantId, '5511900002', 'Cliente Y');
    const first = distributeContact(tenantId, c.lastInsertRowid);
    assert.ok(first);

    const second = distributeContact(tenantId, c.lastInsertRowid);
    assert.equal(second, first, 'Segunda chamada deve retornar o mesmo agente, sem redistribuir');
  });

  test('Distribuição gera mensagem de sistema no chat', () => {
    userQueries.create.run({ id: 'usr_ms_1', tenant_id: tenantId, email: 'ms1@t.com', password_hash: 'h', name: 'Agente Msg', role: 'agent', active: 1, available: 1 });

    const c = db.prepare(`INSERT INTO contacts (tenant_id, wa_phone, name) VALUES (?, ?, ?)`).run(tenantId, '5511900003', 'Cliente Z');
    distributeContact(tenantId, c.lastInsertRowid);

    const msgs = db.prepare(`SELECT * FROM messages WHERE contact_id = ? AND role = 'system'`).all(c.lastInsertRowid);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].content, /Conversa atribuída a Agente Msg/);
  });

  test('Sem atendentes disponíveis, retorna null e não atribui', () => {
    // Nenhum usuário criado neste beforeEach
    const c = db.prepare(`INSERT INTO contacts (tenant_id, wa_phone, name) VALUES (?, ?, ?)`).run(tenantId, '5511900004', 'Cliente Sem');
    const result = distributeContact(tenantId, c.lastInsertRowid);
    assert.equal(result, null);

    const contact = contactQueries.byId.get(c.lastInsertRowid);
    assert.equal(contact.assigned_user_id, null);
  });

  // ── Atribuição Manual ──────────────────────────────────────────────────────

  test('Atribuição manual funciona corretamente via contactQueries.assign', () => {
    userQueries.create.run({ id: 'usr_ma_1', tenant_id: tenantId, email: 'ma1@t.com', password_hash: 'h', name: 'Manual Agent', role: 'agent', active: 1, available: 1 });

    const c = db.prepare(`INSERT INTO contacts (tenant_id, wa_phone, name) VALUES (?, ?, ?)`).run(tenantId, '5511900005', 'Cliente Manual');
    contactQueries.assign.run('usr_ma_1', null, c.lastInsertRowid, tenantId);

    const contact = contactQueries.byId.get(c.lastInsertRowid);
    assert.equal(contact.assigned_user_id, 'usr_ma_1');
    assert.equal(contact.assigned_team_id, null);

    // Re-atribuição a outra equipe/pessoa
    const teamId = 'team_manual_test';
    teamQueries.create.run({ id: teamId, tenant_id: tenantId, name: 'Equipe Manual', description: '' });
    contactQueries.assign.run('usr_ma_1', teamId, c.lastInsertRowid, tenantId);

    const updated = contactQueries.byId.get(c.lastInsertRowid);
    assert.equal(updated.assigned_user_id, 'usr_ma_1');
    assert.equal(updated.assigned_team_id, teamId);
  });
});
