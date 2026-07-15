// users-teams.js - Operations for Users, Invites and Teams

document.addEventListener('DOMContentLoaded', async () => {
  // --- Elementos DOM ---
  const tabUsersBtn = document.getElementById('tabUsersBtn');
  const tabTeamsBtn = document.getElementById('tabTeamsBtn');
  const tabUsersContent = document.getElementById('tabUsersContent');
  const tabTeamsContent = document.getElementById('tabTeamsContent');
  
  const inviteUserBtn = document.getElementById('inviteUserBtn');
  const newTeamBtn = document.getElementById('newTeamBtn');
  
  const inviteModal = document.getElementById('inviteModal');
  const inviteModalClose = document.getElementById('inviteModalClose');
  const inviteForm = document.getElementById('inviteForm');
  
  const teamModal = document.getElementById('teamModal');
  const teamModalClose = document.getElementById('teamModalClose');
  const teamModalTitle = document.getElementById('teamModalTitle');
  const teamForm = document.getElementById('teamForm');
  const teamIdInput = document.getElementById('teamId');
  const teamNameInput = document.getElementById('teamName');
  const teamDescriptionInput = document.getElementById('teamDescription');
  
  const membersModal = document.getElementById('membersModal');
  const membersModalClose = document.getElementById('membersModalClose');
  const membersTeamName = document.getElementById('membersTeamName');
  const membersListContainer = document.getElementById('membersListContainer');
  const saveMembersBtn = document.getElementById('saveMembersBtn');
  
  const usersTableBody = document.getElementById('usersTableBody');
  const invitesTableBody = document.getElementById('invitesTableBody');
  const teamsTableBody = document.getElementById('teamsTableBody');

  // CSRF Token
  const csrfToken = window.csrfToken || '';
  
  // Cache local
  let allUsers = [];
  let currentManagingTeamId = null;

  // --- Inicialização de Perfil ---
  try {
    const r = await fetch('/api/agent/me');
    if (r.ok) {
      const me = await r.json();
      window.ZapUI.setupProfileDropdown(me);
    }
  } catch (err) {
    console.error('Erro ao carregar perfil:', err);
  }

  // --- Gerenciamento de Abas ---
  const setActiveTab = (tab) => {
    if (tab === 'users') {
      tabUsersBtn.classList.add('active');
      tabTeamsBtn.classList.remove('active');
      tabUsersContent.classList.remove('hidden');
      tabTeamsContent.classList.add('hidden');
      newTeamBtn.classList.add('hidden');
      inviteUserBtn.classList.remove('hidden');
    } else {
      tabUsersBtn.classList.remove('active');
      tabTeamsBtn.classList.add('active');
      tabUsersContent.classList.add('hidden');
      tabTeamsContent.classList.remove('hidden');
      newTeamBtn.classList.remove('hidden');
      inviteUserBtn.classList.add('hidden');
    }
  };

  tabUsersBtn.addEventListener('click', () => setActiveTab('users'));
  tabTeamsBtn.addEventListener('click', () => setActiveTab('teams'));
  setActiveTab('users'); // padrão inicial

  // --- Modals Toggle ---
  const toggleModal = (modal, open) => {
    modal.classList.toggle('open', open);
  };

  inviteUserBtn.addEventListener('click', () => {
    inviteForm.reset();
    toggleModal(inviteModal, true);
  });
  inviteModalClose.addEventListener('click', () => toggleModal(inviteModal, false));
  inviteModal.addEventListener('click', (e) => { if(e.target === inviteModal) toggleModal(inviteModal, false); });

  newTeamBtn.addEventListener('click', () => {
    teamModalTitle.textContent = 'Criar nova equipe';
    teamForm.reset();
    teamIdInput.value = '';
    toggleModal(teamModal, true);
  });
  teamModalClose.addEventListener('click', () => toggleModal(teamModal, false));
  teamModal.addEventListener('click', (e) => { if(e.target === teamModal) toggleModal(teamModal, false); });

  membersModalClose.addEventListener('click', () => toggleModal(membersModal, false));
  membersModal.addEventListener('click', (e) => { if(e.target === membersModal) toggleModal(membersModal, false); });

  // --- Fetch e Renderização ---
  const loadData = async () => {
    try {
      const res = await fetch('/api/users');
      if (!res.ok) {
        if (res.status === 403) {
          window.Toast?.show('Você não tem permissão para acessar esta tela.', 'error');
          setTimeout(() => location.href = '/dashboard.html', 1500);
          return;
        }
        throw new Error('Falha ao carregar colaboradores');
      }
      
      const data = await res.json();
      allUsers = data.users || [];
      renderUsers(allUsers);
      renderInvitations(data.invitations || []);
    } catch (err) {
      window.Toast?.show(err.message, 'error');
    }
  };

  const loadTeams = async () => {
    try {
      const res = await fetch('/api/teams');
      if (res.ok) {
        const data = await res.json();
        renderTeams(data.teams || []);
      }
    } catch (err) {
      window.Toast?.show('Erro ao carregar equipes', 'error');
    }
  };

  const renderUsers = (users) => {
    if (!users.length) {
      usersTableBody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding:40px; color:var(--gray-500);">Nenhum colaborador cadastrado.</td></tr>`;
      return;
    }

    usersTableBody.innerHTML = users.map(u => {
      const roleLabel = u.role === 'admin' ? 'Administrador' : 'Atendente';
      const activeClass = u.active ? 'active' : 'inactive';
      const activeLabel = u.active ? 'Ativo' : 'Inativo';
      const availClass = u.available ? 'online' : 'offline';
      const availLabel = u.available ? 'Disponível' : 'Indisponível';

      return `
        <tr>
          <td style="font-weight:600; color:var(--text-primary);">${escapeHtml(u.name)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td>
            <select class="form-select user-role-select" data-id="${u.id}" style="width:130px; padding:4px 8px; font-size:0.8rem; min-height:unset; height:28px;">
              <option value="agent" ${u.role === 'agent' ? 'selected' : ''}>Atendente</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
          </td>
          <td>
            <span class="badge-status ${availClass}">${availLabel}</span>
          </td>
          <td>
            <button class="btn btn-xs ${u.active ? 'btn-success' : 'btn-secondary'} toggle-active-btn" data-id="${u.id}" style="padding:2px 8px; font-size:0.75rem; min-height:unset;">
              ${activeLabel}
            </button>
          </td>
          <td>
            <button class="btn btn-icon btn-danger delete-user-btn" data-id="${u.id}" title="Excluir colaborador">
              <i data-lucide="trash-2" style="width:16px; height:16px;"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons({ root: usersTableBody });
    attachUserActions();
  };

  const renderInvitations = (invites) => {
    if (!invites.length) {
      invitesTableBody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding:40px; color:var(--gray-500);">Não há convites pendentes.</td></tr>`;
      return;
    }

    invitesTableBody.innerHTML = invites.map(i => {
      const roleLabel = i.role === 'admin' ? 'Administrador' : 'Atendente';
      const expDate = new Date(i.expires_at).toLocaleString('pt-BR');
      return `
        <tr>
          <td>${escapeHtml(i.email)}</td>
          <td style="font-weight:600;">${roleLabel}</td>
          <td style="color:var(--gray-500);">${expDate}</td>
          <td>
            <button class="btn btn-icon btn-danger cancel-invite-btn" data-token="${i.token}" title="Cancelar convite">
              <i data-lucide="x" style="width:16px; height:16px;"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons({ root: invitesTableBody });
    attachInviteActions();
  };

  const renderTeams = (teams) => {
    if (!teams.length) {
      teamsTableBody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding:40px; color:var(--gray-500);">Nenhuma equipe cadastrada.</td></tr>`;
      return;
    }

    teamsTableBody.innerHTML = teams.map(t => {
      return `
        <tr>
          <td style="font-weight:600; color:var(--text-primary);">${escapeHtml(t.name)}</td>
          <td style="color:var(--text-secondary); max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(t.description || '')}">
            ${escapeHtml(t.description || '—')}
          </td>
          <td>
            <button class="btn btn-secondary manage-members-btn" data-id="${t.id}" data-name="${escapeHtml(t.name)}" style="padding:4px 10px; font-size:0.75rem; min-height:unset; height:28px;">
              <i data-lucide="users" style="width:14px; height:14px; margin-right:4px;"></i> Membros
            </button>
          </td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-icon btn-secondary edit-team-btn" data-id="${t.id}" data-name="${escapeHtml(t.name)}" data-desc="${escapeHtml(t.description || '')}" title="Editar equipe">
                <i data-lucide="edit" style="width:16px; height:16px;"></i>
              </button>
              <button class="btn btn-icon btn-danger delete-team-btn" data-id="${t.id}" title="Excluir equipe">
                <i data-lucide="trash-2" style="width:16px; height:16px;"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons({ root: teamsTableBody });
    attachTeamActions();
  };

  // --- Submissão de Formulários ---

  // Convidar Usuário
  inviteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('inviteEmail').value;
    const role = document.getElementById('inviteRole').value;
    const saveInviteBtn = document.getElementById('saveInviteBtn');

    saveInviteBtn.disabled = true;
    try {
      const res = await fetch('/api/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (res.ok) {
        window.Toast?.show('Convite enviado com sucesso por e-mail!', 'success');
        toggleModal(inviteModal, false);
        loadData();
      } else {
        window.Toast?.show(data.error || 'Erro ao enviar convite.', 'error');
      }
    } catch {
      window.Toast?.show('Erro de conexão.', 'error');
    } finally {
      saveInviteBtn.disabled = false;
    }
  });

  // Salvar Equipe (Criar / Editar)
  teamForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = teamIdInput.value;
    const name = teamNameInput.value;
    const description = teamDescriptionInput.value;
    const saveTeamBtn = document.getElementById('saveTeamBtn');

    saveTeamBtn.disabled = true;
    const url = id ? `/api/teams/${id}` : '/api/teams';
    const method = id ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ name, description }),
      });
      const data = await res.json();
      if (res.ok) {
        window.Toast?.show(id ? 'Equipe atualizada!' : 'Equipe criada com sucesso!', 'success');
        toggleModal(teamModal, false);
        loadTeams();
      } else {
        window.Toast?.show(data.error || 'Erro ao salvar equipe.', 'error');
      }
    } catch {
      window.Toast?.show('Erro de rede.', 'error');
    } finally {
      saveTeamBtn.disabled = false;
    }
  });

  // --- Handlers de Ação ---

  const attachUserActions = () => {
    // Alterar Papel
    document.querySelectorAll('.user-role-select').forEach(select => {
      select.addEventListener('change', async (e) => {
        const userId = e.target.getAttribute('data-id');
        const newRole = e.target.value;
        try {
          const res = await fetch(`/api/users/${userId}/role`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
            body: JSON.stringify({ role: newRole }),
          });
          if (res.ok) {
            window.Toast?.show('Papel do usuário atualizado.', 'success');
          } else {
            const data = await res.json();
            window.Toast?.show(data.error || 'Falha ao alterar papel.', 'error');
            loadData(); // reseta
          }
        } catch {
          window.Toast?.show('Erro ao conectar ao servidor.', 'error');
          loadData();
        }
      });
    });

    // Ativar/Desativar Usuário
    document.querySelectorAll('.toggle-active-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const userId = e.currentTarget.getAttribute('data-id');
        try {
          const res = await fetch(`/api/users/${userId}/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
          });
          const data = await res.json();
          if (res.ok) {
            window.Toast?.show(`Colaborador ${data.active ? 'ativado' : 'desativado'}.`, 'success');
            loadData();
          } else {
            window.Toast?.show(data.error || 'Erro ao alterar status.', 'error');
          }
        } catch {
          window.Toast?.show('Erro de conexão.', 'error');
        }
      });
    });

    // Excluir Usuário
    document.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const userId = e.currentTarget.getAttribute('data-id');
        const confirm = await window.ZapUI.confirm({
          title: 'Excluir colaborador',
          message: 'Tem certeza que deseja remover este usuário? Ele perderá acesso ao painel imediatamente.',
          confirmText: 'Excluir',
          cancelText: 'Cancelar',
          tone: 'danger',
        });
        if (!confirm) return;

        try {
          const res = await fetch(`/api/users/${userId}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': csrfToken },
          });
          if (res.ok) {
            window.Toast?.show('Colaborador removido.', 'success');
            loadData();
          } else {
            const data = await res.json();
            window.Toast?.show(data.error || 'Erro ao excluir usuário.', 'error');
          }
        } catch {
          window.Toast?.show('Erro de conexão.', 'error');
        }
      });
    });
  };

  const attachInviteActions = () => {
    document.querySelectorAll('.cancel-invite-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const token = e.currentTarget.getAttribute('data-token');
        const confirm = await window.ZapUI.confirm({
          title: 'Cancelar convite',
          message: 'Deseja invalidar este convite de acesso?',
          confirmText: 'Invalidar',
          cancelText: 'Manter',
          tone: 'danger',
        });
        if (!confirm) return;

        try {
          const res = await fetch(`/api/users/invitations/${token}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': csrfToken },
          });
          if (res.ok) {
            window.Toast?.show('Convite cancelado.', 'success');
            loadData();
          } else {
            const data = await res.json();
            window.Toast?.show(data.error || 'Erro ao cancelar convite.', 'error');
          }
        } catch {
          window.Toast?.show('Erro de conexão.', 'error');
        }
      });
    });
  };

  const attachTeamActions = () => {
    // Editar Equipe
    document.querySelectorAll('.edit-team-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const b = e.currentTarget;
        teamModalTitle.textContent = 'Editar equipe';
        teamIdInput.value = b.getAttribute('data-id');
        teamNameInput.value = b.getAttribute('data-name');
        teamDescriptionInput.value = b.getAttribute('data-desc');
        toggleModal(teamModal, true);
      });
    });

    // Excluir Equipe
    document.querySelectorAll('.delete-team-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const teamId = e.currentTarget.getAttribute('data-id');
        const confirm = await window.ZapUI.confirm({
          title: 'Excluir equipe',
          message: 'Deseja remover esta equipe? Os membros cadastrados não serão excluídos, apenas desalocados deste time.',
          confirmText: 'Excluir',
          cancelText: 'Cancelar',
          tone: 'danger',
        });
        if (!confirm) return;

        try {
          const res = await fetch(`/api/teams/${teamId}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': csrfToken },
          });
          if (res.ok) {
            window.Toast?.show('Equipe excluída.', 'success');
            loadTeams();
          } else {
            const data = await res.json();
            window.Toast?.show(data.error || 'Erro ao excluir equipe.', 'error');
          }
        } catch {
          window.Toast?.show('Erro de conexão.', 'error');
        }
      });
    });

    // Gerenciar Membros
    document.querySelectorAll('.manage-members-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const teamId = e.currentTarget.getAttribute('data-id');
        const teamName = e.currentTarget.getAttribute('data-name');
        currentManagingTeamId = teamId;
        membersTeamName.textContent = `Equipe: ${teamName}`;
        
        toggleModal(membersModal, true);
        membersListContainer.innerHTML = 'Carregando colaboradores...';

        try {
          // Busca membros atuais da equipe
          const r = await fetch(`/api/teams/${teamId}/members`);
          if (!r.ok) throw new Error();
          const j = await r.json();
          const memberIds = (j.members || []).map(m => m.id);

          if (!allUsers.length) {
            membersListContainer.innerHTML = '<p class="text-center" style="font-size:0.85rem; color:var(--gray-500);">Nenhum colaborador cadastrado para associar.</p>';
            return;
          }

          membersListContainer.innerHTML = allUsers.map(u => {
            const checked = memberIds.includes(u.id) ? 'checked' : '';
            return `
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.9rem;">
                <input type="checkbox" name="team_members" value="${u.id}" ${checked}>
                <span>${escapeHtml(u.name)} (${escapeHtml(u.email)})</span>
              </label>
            `;
          }).join('');
        } catch {
          window.Toast?.show('Erro ao carregar membros.', 'error');
          toggleModal(membersModal, false);
        }
      });
    });
  };

  // Salvar Membros da Equipe
  saveMembersBtn.addEventListener('click', async () => {
    if (!currentManagingTeamId) return;
    const checkboxes = document.querySelectorAll('input[name="team_members"]:checked');
    const userIds = Array.from(checkboxes).map(cb => cb.value);

    saveMembersBtn.disabled = true;
    try {
      const res = await fetch(`/api/teams/${currentManagingTeamId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ user_ids: userIds }),
      });
      if (res.ok) {
        window.Toast?.show('Membros da equipe atualizados!', 'success');
        toggleModal(membersModal, false);
      } else {
        const data = await res.json();
        window.Toast?.show(data.error || 'Erro ao associar membros.', 'error');
      }
    } catch {
      window.Toast?.show('Erro de conexão.', 'error');
    } finally {
      saveMembersBtn.disabled = false;
    }
  });

  // --- Helpers ---
  const escapeHtml = (str) => {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // --- Inicialização ---
  loadData();
  loadTeams();
});
