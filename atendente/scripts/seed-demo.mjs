// Popula o banco com dados ficticios para o modo demonstracao.
// Importado pelo scripts/demo.mjs (que ja definiu as variaveis de ambiente).
import { createTenant } from '../src/auth.js';
import { db, tenantQueries } from '../src/db.js';

export function seedDemo() {
  if (tenantQueries.byEmail.get('admin@demo.com')) return;

  const t = createTenant('admin@demo.com', '123456');

  tenantQueries.updateSettings.run({
    id: t.id,
    business_name: 'Amazônia Aromas',
    atendente_name: 'Bia',
    checkout_url: 'https://loja.amazoniaaromas.com.br/checkout',
    notify_phone: '5511961802804',
    wa_phone_number_id: '100000000000001',
    wa_token: 'demo-token',
    mp_access_token: 'demo-mp-token',
    // updateSettings exige todos os named params; deixamos os de frete/Melhor
    // Envio nulos porque o modo demo não faz cálculo de frete real.
    cep_origem: null,
    melhor_envio_token: null,
    business_json: JSON.stringify({
      descricao: `A Amazônia Aromas, fundada em 2005, cria aromatizantes e difusores de alta qualidade inspirados na riqueza natural da Amazônia. Nossos produtos perfumam ambientes, armários e tecidos com fragrâncias únicas e duradouras — acessíveis para o consumidor final e altamente rentáveis para revendedores. Presente no Magazine Luiza, Mercado Livre e loja própria.`,

      tomDeVoz: `Próximo, acolhedor e apaixonado por bem-estar. Use emojis com moderação (🌿🌸✨). Evite linguagem técnica. Fale como uma amiga que entende de aromas e quer ajudar a pessoa a escolher o produto certo para o momento dela.`,

      frete: `Frete grátis para compras acima de R$ 150. Abaixo disso, o frete é calculado pelo CEP do cliente via Correios (PAC ou SEDEX). Prazo médio: 3 a 8 dias úteis (PAC) ou 1 a 3 dias úteis (SEDEX). Pergunte o CEP do cliente para informar o valor exato. Enviamos para todo o Brasil.`,

      produtos: [
        {
          nome: 'Difusor de Ambiente Amazônia Aromas 270ml',
          preco: 'R$ 25,90',
          descricao: 'Difusor com varetas de bambu. Perfuma gradualmente por até 60 dias.',
          diferenciais: ['Fragrâncias exclusivas', 'Sem álcool', 'Dura até 60 dias'],
          variacoes: ['Lavanda Francesa', 'Limão Siciliano', 'Baunilha', 'Eucalipto', 'Jasmim'],
        },
        {
          nome: 'Difusor Brasilidades 270ml',
          preco: 'R$ 28,90',
          descricao: 'Linha especial com fragrâncias inspiradas no Brasil. Ótima opção para presente.',
          diferenciais: ['Embalagem presenteável', 'Fragrâncias brasileiras exclusivas'],
          variacoes: ['Floresta Brasileira', 'Amora', 'Patchouli', 'Açaí'],
        },
        {
          nome: 'Difusor Premium 270ml',
          preco: 'R$ 42,90',
          descricao: 'Nossa linha topo de linha. Fragrâncias sofisticadas e embalagem premium.',
          diferenciais: ['Alta concentração de essência', 'Ideal para ambientes nobres', 'Dura até 90 dias'],
          variacoes: ['Oud & Âmbar', 'Peônia Rose', 'Cedro & Sândalo'],
        },
        {
          nome: 'Aromatizante de Ambiente 300ml 24h',
          preco: 'R$ 18,90',
          descricao: 'Spray de aromatizante de longa duração. Basta um jato para perfumar o ambiente por horas.',
          diferenciais: ['Ação rápida', 'Frasco de 300ml', 'Mais de 200 jatos'],
          variacoes: ['Lavanda', 'Talco', 'Frutas Vermelhas', 'Limão', 'Bambu'],
        },
        {
          nome: 'Odorizador de Tecidos 500ml',
          preco: 'R$ 22,90',
          descricao: 'Perfuma roupas, estofados, cortinas e cama. Elimina odores e deixa tudo cheiroso.',
          diferenciais: ['Específico para tecidos', 'Não mancha', 'Alta durabilidade'],
          variacoes: ['Floral', 'Lavanda', 'Baby (cheirinho de neném)', 'Algodão'],
        },
        {
          nome: 'Sabonete Líquido 500ml',
          preco: 'R$ 24,90',
          descricao: 'Sabonete cremoso com fragrâncias exclusivas para uso diário.',
          diferenciais: ['Hidratante', 'pH neutro', 'Embalagem com dosador'],
          variacoes: ['Cereja e Avelã', 'Lavanda', 'Pêssego', 'Vanilla'],
        },
        {
          nome: 'Aromatizante para Armários (sachê)',
          preco: 'R$ 12,90',
          descricao: 'Sachê perfumado para guardar em armários, gavetas e malas. Afasta traças e umidade.',
          diferenciais: ['Dura até 3 meses', 'Protege roupas', 'Fácil de usar'],
          variacoes: ['Lavanda', 'Cedro', 'Rosas'],
        },
        {
          nome: 'Bloqueador de Odor 500ml',
          preco: 'R$ 32,90',
          descricao: 'Neutraliza odores fortes de cozinha, animais de estimação e fumaça.',
          diferenciais: ['Elimina odor na hora', 'Não mascara — neutraliza', 'Para ambientes exigentes'],
          variacoes: ['Original', 'Com aroma de Lavanda'],
        },
        {
          nome: 'Kit Presente Amazônia Aromas',
          preco: 'A partir de R$ 69,90',
          descricao: 'Kits montados com difusor + aromatizante ou combinações especiais. Perfeito para presentear.',
          diferenciais: ['Embalagem para presente', 'Combinações exclusivas', 'Opções para todos os gostos'],
          variacoes: ['Kit Lavanda (difusor + spray)', 'Kit Brasilidades (2 difusores)', 'Kit Premium (difusor premium + sachê)'],
        },
      ],

      perguntasFrequentes: [
        { pergunta: 'Quanto tempo dura o difusor?', resposta: 'O difusor padrão dura até 60 dias e o Premium até 90 dias, dependendo da ventilação do ambiente.' },
        { pergunta: 'Posso usar o odorizador de tecidos em roupas claras?', resposta: 'Sim! O nosso odorizador não mancha tecidos. Basta aplicar a 30cm de distância.' },
        { pergunta: 'Vocês têm opções para presentear?', resposta: 'Temos! Nossos Kits Presente vêm em embalagem especial e são perfeitos para qualquer ocasião.' },
        { pergunta: 'O produto tem cheiro muito forte?', resposta: 'Nossa linha é equilibrada — perfuma sem enjoar. O difusor age de forma gradual e suave.' },
        { pergunta: 'Tem nota fiscal?', resposta: 'Sim, emitimos NF-e para todas as compras.' },
        { pergunta: 'Posso revender os produtos?', resposta: 'Com certeza! Temos condições especiais para revendedores. Me conta mais sobre seu interesse e eu te passo os detalhes.' },
      ],

      objecoesComuns: [
        { objecao: 'Está caro', resposta: 'Reforce a qualidade, durabilidade e o custo por dia de uso (ex: difusor a R$25 dura 60 dias = R$0,42/dia). Ofereça um kit se couber no orçamento.' },
        { objecao: 'Vou pensar', resposta: 'Pergunte o que falta para decidir. Ofereça ajuda para comparar modelos ou sugira começar pelo produto mais acessível.' },
        { objecao: 'O frete ficou caro', resposta: 'Sugira completar o pedido até R$ 150 para ganhar frete grátis — geralmente vale mais um sachê ou spray.' },
        { objecao: 'Nunca ouvi falar dessa marca', resposta: 'Explique que a marca tem 20 anos de mercado, está no Magazine Luiza e Mercado Livre, com milhares de avaliações positivas.' },
      ],

      regras: [
        'Nunca invente fragrâncias ou produtos que não estão na lista.',
        'Não prometa frete grátis para pedidos abaixo de R$ 150.',
        'Se o cliente quiser revender, colete nome, cidade e WhatsApp e avise que o responsável comercial vai entrar em contato.',
        'Sempre pergunte a preferência de fragrância antes de indicar um produto.',
      ],
    }),
  });

  const insContact = db.prepare(`
    INSERT INTO contacts (tenant_id, wa_phone, name, stage, buy_intent, summary, needs_human, created_at, last_message_at)
    VALUES (@tid, @phone, @name, @stage, @intent, @summary, @human, datetime('now', @ago), datetime('now', @last))
  `);
  const insMsg = db.prepare(`INSERT INTO messages (contact_id, role, content) VALUES (?, ?, ?)`);

  const data = [
    ['Ana Paula Mendes',   'novo_contato', 'baixa', 'Chegou perguntando sobre difusores para sala',                         0, '-13 days', '-13 days'],
    ['Roberto Figueiredo', 'novo_contato', 'baixa', 'Pediu informações sobre a linha de produtos',                          0, '-12 days', '-11 days'],
    ['Isabela Corrêa',     'duvida',       'media', 'Quer saber se o difusor funciona em ambientes grandes',               0, '-11 days', '-10 days'],
    ['Carlos Henrique',    'duvida',       'media', 'Perguntou sobre qual fragrância é mais suave para quarto',            0, '-10 days', '-9 days'],
    ['Patrícia Aguiar',    'duvida',       'media', 'Dúvida se odorizador de tecidos mancha roupa branca',                0, '-9 days',  '-8 days'],
    ['Marcos Teixeira',    'orcamento',    'media', 'Pediu preço do kit presente para o Dia das Mães',                    0, '-8 days',  '-7 days'],
    ['Vanessa Duarte',     'orcamento',    'alta',  'Quer 3 difusores de lavanda, perguntando desconto por quantidade',   0, '-7 days',  '-6 days'],
    ['Ricardo Andrade',    'orcamento',    'alta',  'Pediu orçamento para revenda — quer saber condições',                1, '-7 days',  '-2 days'],
    ['Letícia Moraes',     'negociacao',   'alta',  'Achou o frete caro, considerando completar para R$150',              0, '-6 days',  '-5 days'],
    ['Felipe Barbosa',     'negociacao',   'media', 'Comparando difusor Premium com concorrente, pediu diferencial',      0, '-5 days',  '-3 days'],
    ['Simone Castro',      'checkout',     'alta',  'Recebeu link de pagamento, vai pagar no Pix hoje',                   0, '-4 days',  '-1 days'],
    ['Eduardo Pinto',      'checkout',     'alta',  'No checkout, dúvida sobre parcelamento no cartão',                   1, '-3 days',  '-1 days'],
    ['Fernanda Rocha',     'fechado',      'alta',  'Comprou Kit Presente Lavanda para o Dia das Mães ✅',                0, '-5 days',  '-4 days'],
    ['Thiago Nascimento',  'fechado',      'alta',  'Comprou 2 difusores Brasilidades + odorizador ✅',                   0, '-4 days',  '-3 days'],
    ['Mariana Cunha',      'fechado',      'alta',  'Recompra — 3ª vez comprando difusor Premium ✅',                     0, '-3 days',  '-2 days'],
    ['Alexandre Lima',     'fechado',      'alta',  'Fechou após ganhar frete grátis completando pedido ✅',              0, '-1 days',  '-1 days'],
    ['Débora Alves',       'perdido',      'baixa', 'Disse que ia pensar no presente e não voltou mais',                  0, '-9 days',  '-6 days'],
    ['Gustavo Ferreira',   'perdido',      'baixa', 'Achou caro comparado ao produto de supermercado',                    0, '-2 days',  '-2 days'],
    ['Camila Batista',     'novo_contato', 'baixa', 'Chegou agora pelo Instagram, quer saber sobre aromas para escritório',0, '0 days',  '0 days'],
    ['André Monteiro',     'duvida',       'media', 'Perguntando prazo de entrega para o interior de SP',                 0, '0 days',  '0 days'],
  ];

  const sample = {
    user: [
      'Oi! Vi vocês no Instagram e adorei 😍',
      'Qual difusor vocês recomendam para quarto de casal?',
      'Tem fragrância de lavanda?',
      'Qual o prazo de entrega para o meu CEP?',
      'Quero comprar! Como faço?',
    ],
    assistant: [
      'Oi! Que alegria ter você aqui! 🌿 Sou a Bia, da Amazônia Aromas.',
      'Para quarto de casal, adoro indicar o Difusor Lavanda Francesa — suave, relaxante e dura 60 dias 😊',
      'Temos sim! A Lavanda Francesa é nossa mais pedida. Quer que eu te mande mais detalhes?',
      'Aqui no site você calcula o frete pelo CEP: loja.amazoniaaromas.com.br — mas compras acima de R$150 têm frete grátis! 🎁',
      'Perfeito! Aqui está o link para finalizar seu pedido: loja.amazoniaaromas.com.br/checkout 🛒',
    ],
  };

  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  const contactIds = [];
  for (const [name, stage, intent, summary, human, ago, last] of data) {
    const phone = '5511' + Math.floor(900000000 + rand() * 99999999);
    const info = insContact.run({ tid: t.id, phone, name, stage, intent, summary, human, ago, last });
    const cid = info.lastInsertRowid;
    contactIds.push({ id: cid, name });
    const turns = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < turns; i++) {
      insMsg.run(cid, 'user', sample.user[i % sample.user.length]);
      insMsg.run(cid, 'assistant', sample.assistant[i % sample.assistant.length]);
    }
  }

  // Vendas de exemplo para o Painel de Vendas não abrir vazio no demo.
  // total_cents e items_json são as colunas canônicas usadas hoje (o
  // renderizador da tabela usa total_cents; ver public/js/pages/vendas.js).
  const insSale = db.prepare(`
    INSERT INTO sales (id, tenant_id, contact_id, status, total_cents, items_json, created_at, updated_at, paid_at)
    VALUES (@id, @tid, @cid, @status, @total_cents, @items_json, @created_at, @created_at, @paid_at)
  `);
  const findContact = (name) => contactIds.find((c) => c.name === name)?.id ?? contactIds[0]?.id ?? null;
  const daysAgoIso = (n) => new Date(Date.now() - n * 86400 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  const salesData = [
    {
      id: 'demo-sale-fernanda',
      contact: 'Fernanda Rocha',
      status: 'pago',
      total_cents: 6990,
      items_json: JSON.stringify([{ titulo: 'Kit Presente Amazônia Aromas', quantidade: 1, valor_unitario: 69.9 }]),
      daysAgo: 5,
      paid: true,
    },
    {
      id: 'demo-sale-thiago',
      contact: 'Thiago Nascimento',
      status: 'pago',
      total_cents: 8070,
      items_json: JSON.stringify([
        { titulo: 'Difusor Brasilidades 270ml', quantidade: 2, valor_unitario: 28.9 },
        { titulo: 'Odorizador de Tecidos 500ml', quantidade: 1, valor_unitario: 22.9 },
      ]),
      daysAgo: 4,
      paid: true,
    },
    {
      id: 'demo-sale-mariana',
      contact: 'Mariana Cunha',
      status: 'pago',
      total_cents: 4290,
      items_json: JSON.stringify([{ titulo: 'Difusor Premium 270ml', quantidade: 1, valor_unitario: 42.9 }]),
      daysAgo: 3,
      paid: true,
    },
    {
      id: 'demo-sale-eduardo',
      contact: 'Eduardo Pinto',
      status: 'aguardando_pagamento',
      total_cents: 4290,
      items_json: JSON.stringify([{ titulo: 'Difusor Premium 270ml', quantidade: 1, valor_unitario: 42.9 }]),
      daysAgo: 1,
      paid: false,
    },
  ];

  for (const s of salesData) {
    const created_at = daysAgoIso(s.daysAgo);
    insSale.run({
      id: s.id,
      tid: t.id,
      cid: findContact(s.contact),
      status: s.status,
      total_cents: s.total_cents,
      items_json: s.items_json,
      created_at,
      paid_at: s.paid ? created_at : null,
    });
  }
}
