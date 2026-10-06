# Fabula Ultima — Cena de Combate

Protótipo de uma interface multiplayer de combate em navegador inspirada na apresentação de JRPGs.

> Este projeto é independente e não oficial. O objetivo inicial é criar a infraestrutura e a experiência de combate, sem redistribuir conteúdo protegido dos livros de Fabula Ultima.

## Objetivo do MVP

A primeira versão deve permitir:

- criar uma sala de combate;
- jogadores entrarem por um link;
- o mestre aceitar participantes;
- cadastrar personagens e inimigos;
- atribuir um personagem a cada jogador;
- manter HP, MP e IP sincronizados em tempo real;
- mostrar quem está conectado e de quem é o turno;
- realizar rolagens de dados no servidor;
- exibir uma cena de combate em estilo JRPG;
- reconectar sem perder o estado atual do combate.

A automação completa das regras de Fabula Ultima **não** faz parte do primeiro MVP.

## Arquitetura inicial

```text
Browser do GM ─┐
Browser jogador ├── React + TypeScript ── Supabase
Celular jogador ┘                         ├─ Postgres (estado persistente)
                                         ├─ Realtime (sincronização)
                                         └─ funções/RPC (ações autoritativas)
```

O navegador apenas solicita ações. A autoridade do combate fica no backend.

Exemplo:

```text
Jogador: "quero atacar o Slime"
          ↓
Backend valida personagem/turno
          ↓
Backend rola os dados e atualiza o estado
          ↓
Todos os clientes recebem o mesmo evento/estado
          ↓
Cada navegador reproduz a animação localmente
```

## Stack planejada

- React
- TypeScript
- Vite
- Supabase
  - PostgreSQL
  - Realtime
  - Presence
  - RPC / Edge Functions quando necessário
- CSS para a primeira interface
- PixiJS apenas se as animações futuras justificarem

## Hospedagem

O projeto tem duas partes diferentes:

### Frontend

O build de React/Vite gera arquivos estáticos (`HTML/CSS/JS`). Portanto o frontend **pode** ser hospedado em GitHub Pages, Cloudflare Pages, Vercel ou qualquer servidor HTTP.

### Backend

O multiplayer precisa de um backend persistente e em tempo real.

Para desenvolvimento/MVP, a proposta inicial é usar **Supabase hospedado**. Assim não precisamos manter Postgres, WebSockets, backups, TLS e autenticação desde o primeiro dia.

Self-hosting continua sendo uma opção futura. Quando o projeto justificar, podemos mover o backend para um VPS usando Docker.

## Princípio de aprendizado

O projeto será desenvolvido em etapas pequenas. Cada etapa deve:

1. resolver um problema concreto;
2. explicar o conceito antes ou junto da implementação;
3. incluir testes quando a lógica for relevante;
4. evitar abstrações que ainda não são necessárias;
5. manter commits pequenos e legíveis.

## Roadmap curto

1. Bootstrap React + TypeScript.
2. Criar a tela de batalha local com dados falsos.
3. Modelar personagem, combatente e batalha.
4. Criar projeto Supabase e esquema inicial.
5. Criar/entrar em sala.
6. Presence: mostrar jogadores conectados.
7. Sincronizar HP/MP/IP.
8. Controle de personagem e turnos.
9. Rolagens autoritativas.
10. Animações e polimento JRPG.

## Licença e conteúdo

Antes de publicar conteúdo derivado do sistema, classes, habilidades, textos ou artes oficiais, será necessário revisar as permissões/licenças aplicáveis. O motor e a interface podem ser desenvolvidos sem incorporar conteúdo proprietário do livro.
