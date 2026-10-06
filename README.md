# Fabula Ultima — Cena de Combate

Protótipo de uma interface multiplayer de combate em navegador inspirada na apresentação de JRPGs.

> Este projeto é independente e não oficial. O objetivo inicial é criar a infraestrutura e a experiência de combate, sem redistribuir conteúdo protegido dos livros de Fabula Ultima.

## Estado atual

Primeiro checkpoint concluído:

- React + TypeScript + Vite configurados;
- cena de combate local funcionando;
- combatentes com HP, MP e IP;
- seleção de combatente;
- alteração local de HP;
- layout responsivo básico;
- GitHub Actions validando o build;
- GitHub Pages publicando o frontend;
- cliente Supabase preparado por variáveis de ambiente.

O estado do combate ainda vive apenas no navegador. Persistência e multiplayer entram na próxima etapa.

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

## Stack

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

## Rodando localmente

Requer Node.js e npm.

```bash
git clone https://github.com/davivicente2/Fabula-Ultima-Cena-de-Combate.git
cd Fabula-Ultima-Cena-de-Combate
npm install
cp .env.example .env.local
npm run dev
```

Preencha o `.env.local` com a URL e a **Publishable key** do projeto Supabase:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sua_publishable_key
```

Nunca coloque senha do banco, `service_role`, secret key ou JWT secret em variáveis `VITE_`.

## Hospedagem

O frontend é compilado pelo Vite e publicado pelo GitHub Actions no GitHub Pages.

O Pages deve usar:

```text
Settings → Pages → Source → GitHub Actions
```

O frontend publicado fica em:

```text
https://davivicente2.github.io/Fabula-Ultima-Cena-de-Combate/
```

O backend do MVP fica no Supabase Cloud. Self-hosting continua sendo uma opção futura.

## Princípio de aprendizado

O projeto será desenvolvido em etapas pequenas. Cada etapa deve:

1. resolver um problema concreto;
2. explicar o conceito antes ou junto da implementação;
3. incluir testes quando a lógica for relevante;
4. evitar abstrações que ainda não são necessárias;
5. manter commits pequenos e legíveis.

## Próximo checkpoint

A próxima etapa é persistência:

```text
Criar batalha
    ↓
salvar no Supabase
    ↓
recarregar a página
    ↓
a batalha continua existindo
```

Depois disso entra Realtime:

```text
Chrome altera HP
       ↓
    Supabase
       ↓
Firefox atualiza sozinho
```

## Roadmap curto

1. Bootstrap React + TypeScript. ✅
2. Criar a tela de batalha local com dados falsos. ✅
3. Modelar combatente e recursos básicos. ✅
4. Criar projeto Supabase e conexão inicial. ✅
5. Persistir batalha e combatentes.
6. Criar/entrar em sala.
7. Presence: mostrar jogadores conectados.
8. Sincronizar HP/MP/IP em tempo real.
9. Controle de personagem e turnos.
10. Rolagens autoritativas.
11. Animações e polimento JRPG.

## Licença e conteúdo

Antes de publicar conteúdo derivado do sistema, classes, habilidades, textos ou artes oficiais, será necessário revisar as permissões/licenças aplicáveis. O motor e a interface podem ser desenvolvidos sem incorporar conteúdo proprietário do livro.
