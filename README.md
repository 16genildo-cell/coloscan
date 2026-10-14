# ColoScan API + painel administrativo

Node.js · Express 5 · EJS · MongoDB (Mongoose).

- **API do app** (`/api/v1`): registro anônimo do dispositivo, envio da imagem para análise por IA, consulta e exclusão dos próprios resultados.
- **Painel** (`/admin`): login, escolha do provedor de IA (Anthropic, OpenAI ou Gemini), chaves de API (guardadas criptografadas), prompt, limites, retenção, lista de análises e dispositivos, administradores e registro de ações.

> A imagem **nunca é salva**: fica só na memória durante a análise. O servidor guarda apenas o resultado em texto, apagado automaticamente após o prazo de retenção.

## Requisitos

- Node.js 20 ou mais novo
- MongoDB 6+ (local ou MongoDB Atlas)

## Instalação

```bash
cd api
npm install
copy .env.example .env      # Windows (no Linux/macOS: cp .env.example .env)
```

Edite o `.env`:

1. `MONGODB_URI`: endereço do MongoDB.
2. `SESSION_SECRET`: texto longo e aleatório.
3. `SETTINGS_ENCRYPTION_KEY`: gere com
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
4. `ADMIN_EMAIL` / `ADMIN_PASSWORD` (mínimo 10 caracteres): o primeiro administrador é criado na primeira execução.

```bash
npm start          # http://localhost:3000/admin
npm test           # testes automatizados (precisa de MongoDB em 127.0.0.1:27017)
```

## Configurar a IA (no painel)

1. Entre em `http://localhost:3000/admin`.
2. **Configurações de IA**: escolha o provedor, informe o modelo (ou deixe o padrão), cole a chave de API e marque **Análise por IA ativada**.
3. Clique em **Testar agora** para validar a chave e o modelo.

### Como a análise por IA funciona

- **Saída estruturada:** o servidor envia um schema JSON (ferramenta forçada na Anthropic, `json_schema` estrito na OpenAI, `responseSchema` no Gemini). Se o modelo escolhido não aceitar, o servidor repete sem schema e lembra disso até reiniciar.
- **Critérios visuais:** cada análise leva os critérios de cada código (`services/analysisPrompt.js`) e pede uma avaliação da qualidade da foto antes da descrição. Os critérios vão na instrução da análise, então valem mesmo com um prompt personalizado salvo.
- **Qualidade da foto:** problemas como foto escura, desfocada ou com reflexo viram orientações padronizadas ao usuário; "não parece fezes" sempre resulta em inconclusivo.
- **Certeza:** a IA marca cada característica como evidente ou possível; as possíveis são registradas com o aviso de que a imagem não permite certeza (sinais de atenção nunca são omitidos por dúvida).
- **Consistência:** só uma cor predominante e uma consistência são mantidas; sangue, cor muito escura, cor muito clara e muco aparecem primeiro.
- **Nova tentativa:** uma repetição em resposta inválida, limite do provedor ou falha temporária, dentro do tempo limite do painel. Chave inválida e tempo esgotado não são repetidos.

> Instalações antigas têm o prompt anterior salvo no banco. Para usar o novo, use a opção de restaurar o prompt padrão em **Configurações de IA**.

## Conectar o app

No app: **Perfil › Servidor de análise** → informe o endereço da API e toque em **Testar e salvar**.

- Celular físico na mesma rede Wi-Fi: `http://IP-DO-COMPUTADOR:3000` (só funciona com o app em modo debug).
- Emulador Android: `http://10.0.2.2:3000`.
- Produção: **use HTTPS** (`https://api.seu-dominio.com.br`). Builds de release só aceitam HTTPS.

Também é possível fixar o endereço no build: `flutter run --dart-define=COLOSCAN_API_BASE_URL=https://...`

## Endpoints

| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| GET | `/api/v1/health` | — | Estado e se a análise está disponível |
| POST | `/api/v1/devices/register` | — (20/h por IP) | Cria token anônimo do dispositivo |
| DELETE | `/api/v1/devices/me` | Bearer | Apaga o dispositivo e todas as suas análises |
| POST | `/api/v1/image-analysis` | Bearer (limite/h configurável) | `multipart`: `image`, `consent_version`, `consent_at` |
| GET | `/api/v1/image-analysis/:id` | Bearer (só o dono) | Consulta resultado |
| DELETE | `/api/v1/image-analysis/:id` | Bearer (só o dono) | Exclui resultado |

O formato da resposta segue `../docs/API_CONTRACT.md`. `clinically_validated` é sempre `false`.

## Segurança implementada

- Chaves de IA criptografadas com AES-256-GCM (`SETTINGS_ENCRYPTION_KEY`) e nunca reexibidas no painel.
- Token do dispositivo aleatório (256 bits); o servidor guarda só o hash SHA-256.
- Cada dispositivo só acessa as próprias análises.
- Formato da imagem validado pelo conteúdo do arquivo; limites de tamanho e de frequência.
- Resposta da IA validada: somente códigos permitidos, e textos com diagnóstico, câncer ou porcentagens são substituídos.
- Painel com senha bcrypt, sessão em cookie `httpOnly` + `SameSite=Strict` (`Secure` em produção), proteção CSRF, limite de tentativas de login, cabeçalhos de segurança (Helmet/CSP) e registro de ações administrativas.
- Logs sem imagens, tokens, chaves ou resultados.

## Pendências para produção

- HTTPS (proxy reverso com TLS) e `NODE_ENV=production`, `TRUST_PROXY=1`.
- Backup e criptografia em repouso do MongoDB (Atlas já oferece).
- Verificar se os termos do provedor de IA permitem dados de saúde e onde os dados são processados (LGPD: transferência internacional).
- Revisão jurídica do consentimento, da política de retenção e do encarregado (DPO).
