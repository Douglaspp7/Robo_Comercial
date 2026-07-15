/**
 * Templates por nicho (Fase 13) — sugestões prontas de FAQs, objeções,
 * respostas rápidas e regras para reduzir o esforço inicial de configuração.
 * Aplicadas só sob ação explícita do lojista (nunca sobrescrevem o que já
 * existe — a UI só adiciona o que falta).
 */
export const NICHE_TEMPLATES = {
  roupas: {
    label: 'Loja de roupas',
    faqs: [
      { pergunta: 'Vocês têm tabela de medidas?', resposta: 'Sim! Posso te enviar a tabela de medidas para você escolher o tamanho certo.' },
      { pergunta: 'Posso trocar se não servir?', resposta: 'Sim, você tem até 7 dias após o recebimento para solicitar troca, desde que o produto esteja sem uso e com etiqueta.' },
      { pergunta: 'Tem em outras cores?', resposta: 'Depende do modelo — me diga qual peça te interessou que eu confirmo as cores disponíveis.' },
    ],
    objecoes: [
      { objecao: 'Não sei meu tamanho', resposta: 'Sem problema! Me conta suas medidas (busto, cintura, quadril) que te ajudo a escolher o tamanho ideal.' },
    ],
    respostas_rapidas: [
      'Esse modelo está disponível nos tamanhos P, M, G e GG 😊',
      'Posso te enviar mais fotos do produto em diferentes ângulos!',
      'Fazemos troca em até 7 dias após o recebimento, sem problema.',
    ],
    regras: ['Sempre perguntar o tamanho antes de confirmar o pedido.', 'Informar a política de troca quando o cliente perguntar sobre tamanho ou cor.'],
  },
  eletronicos: {
    label: 'Eletrônicos',
    faqs: [
      { pergunta: 'O produto tem garantia?', resposta: 'Sim, todos os produtos têm garantia de fábrica. O prazo varia por item — me diga qual produto que confirmo.' },
      { pergunta: 'É original/lacrado?', resposta: 'Sim, trabalhamos só com produtos originais e lacrados de fábrica.' },
      { pergunta: 'Tem nota fiscal?', resposta: 'Sim, emitimos nota fiscal para todos os pedidos.' },
    ],
    objecoes: [
      { objecao: 'Achei mais barato em outro lugar', resposta: 'Entendo! Aqui você tem garantia, nota fiscal e suporte pós-venda — vale considerar o custo-benefício completo.' },
    ],
    respostas_rapidas: [
      'Esse produto é original e vem com garantia de fábrica 👍',
      'Posso confirmar a nota fiscal junto com o pedido!',
      'Temos esse modelo em estoque, posso calcular o frete para você.',
    ],
    regras: ['Sempre mencionar garantia e nota fiscal quando o cliente perguntar sobre autenticidade.'],
  },
  cosmeticos: {
    label: 'Cosméticos',
    faqs: [
      { pergunta: 'É dermatologicamente testado?', resposta: 'Sim, nossos produtos passam por testes dermatológicos e são seguros para uso diário.' },
      { pergunta: 'Serve para pele sensível?', resposta: 'Depende do produto — me diga qual item te interessou que eu confirmo a indicação para o seu tipo de pele.' },
      { pergunta: 'Qual o prazo de validade?', resposta: 'Todos os produtos saem de fábrica com validade de pelo menos 1 ano.' },
    ],
    objecoes: [],
    respostas_rapidas: [
      'Esse produto é indicado para todos os tipos de pele 😊',
      'Posso te enviar o modo de uso detalhado!',
      'Temos essa fragrância disponível em outros tamanhos também.',
    ],
    regras: ['Nunca prometer resultado médico/estético específico — falar em termos de indicação de uso.'],
  },
  autopecas: {
    label: 'Autopeças',
    faqs: [
      { pergunta: 'Essa peça serve no meu carro?', resposta: 'Me diga o modelo, ano e versão do seu veículo que confirmo a compatibilidade.' },
      { pergunta: 'A peça é original ou paralela?', resposta: 'Trabalhamos com peças originais e paralelas de qualidade — posso te mostrar as opções disponíveis.' },
      { pergunta: 'Tem garantia?', resposta: 'Sim, todas as peças têm garantia. O prazo varia por item.' },
    ],
    objecoes: [],
    respostas_rapidas: [
      'Me confirma o modelo, ano e versão do carro para eu checar a compatibilidade?',
      'Temos essa peça original e a versão paralela também, quer ver as duas opções?',
      'Posso calcular o frete assim que você me passar o CEP.',
    ],
    regras: ['Sempre confirmar modelo/ano/versão do veículo antes de indicar uma peça.'],
  },
  doces_delivery: {
    label: 'Doces e delivery',
    faqs: [
      { pergunta: 'Vocês fazem encomenda para o mesmo dia?', resposta: 'Depende da quantidade e do item — me conta o que você precisa e para quando, que confirmo a disponibilidade.' },
      { pergunta: 'Tem opção sem lactose/glúten?', resposta: 'Temos algumas opções — me diga sua restrição que confirmo o que está disponível.' },
      { pergunta: 'Qual o valor mínimo do pedido?', resposta: 'Deixa eu confirmar isso para sua região — me passa seu CEP?' },
    ],
    objecoes: [],
    respostas_rapidas: [
      'Consigo entregar hoje ainda, dependendo do horário do pedido!',
      'Temos opção sem lactose/glúten sim, quer que eu confirme os itens?',
      'Posso te mandar o cardápio completo em PDF.',
    ],
    regras: ['Sempre confirmar prazo de entrega e horário de corte para pedidos do mesmo dia.'],
  },
  mercado_livre: {
    label: 'Produtos de Mercado Livre (revenda)',
    faqs: [
      { pergunta: 'Por que comprar direto pelo WhatsApp?', resposta: 'Aqui você tem atendimento direto, condições especiais e agilidade — sem taxas extras de outras plataformas.' },
      { pergunta: 'É o mesmo produto do anúncio?', resposta: 'Sim, exatamente o mesmo produto e condição do anúncio que você viu.' },
      { pergunta: 'Como funciona o pagamento?', resposta: 'Aceitamos Pix, cartão e boleto através de um link de pagamento seguro.' },
    ],
    objecoes: [],
    respostas_rapidas: [
      'Esse é o mesmo produto do anúncio, com a vantagem de atendimento direto por aqui 😊',
      'Posso te enviar o link de pagamento agora mesmo.',
      'Consigo confirmar prazo de entrega para o seu CEP.',
    ],
    regras: [],
  },
  acessorios: {
    label: 'Acessórios',
    faqs: [
      { pergunta: 'É banhado a ouro/prata?', resposta: 'Sim, me diga qual peça te interessou que eu confirmo o material exato.' },
      { pergunta: 'Dá para gravar/personalizar?', resposta: 'Depende do modelo — alguns aceitam personalização. Me diga qual peça você quer.' },
      { pergunta: 'É hipoalergênico?', resposta: 'Temos opções hipoalergênicas — me diga qual peça te interessou que eu confirmo.' },
    ],
    objecoes: [],
    respostas_rapidas: [
      'Essa peça é banhada e vem com certificado de garantia 😊',
      'Posso te mostrar mais fotos com zoom nos detalhes!',
      'Temos essa opção em outros tamanhos/cores também.',
    ],
    regras: [],
  },
  servicos_locais: {
    label: 'Serviços locais',
    faqs: [
      { pergunta: 'Vocês atendem na minha região?', resposta: 'Me diga seu bairro/cidade que confirmo se atendemos sua região.' },
      { pergunta: 'Como funciona o orçamento?', resposta: 'O orçamento é gratuito — me conta o que você precisa que já te passo uma estimativa.' },
      { pergunta: 'Qual o prazo para agendar?', resposta: 'Normalmente conseguimos agendar em poucos dias — me diga sua disponibilidade que confirmo um horário.' },
    ],
    objecoes: [],
    respostas_rapidas: [
      'Consigo te passar um orçamento sem compromisso, quer?',
      'Atendemos sim sua região! Vamos agendar um horário?',
      'Posso confirmar a disponibilidade para essa semana.',
    ],
    regras: ['Sempre confirmar a região de atendimento antes de seguir com o orçamento.'],
  },
};

export const NICHE_IDS = Object.keys(NICHE_TEMPLATES);
