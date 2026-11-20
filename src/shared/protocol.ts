/**
 * Contrato de compatibilidade entre o cliente e a API.
 *
 * O cliente só libera o jogo depois de confirmar que fala o mesmo protocolo
 * que o servidor (`/api/health`) e o servidor só aceita mensagens de jogo
 * depois de receber um `client:hello` compatível. A igualdade é exata: os dois
 * lados precisam ser publicados juntos (Vercel + VPS).
 *
 * Regras de versão:
 * - o cliente compara a própria versão com a do `/api/health`;
 * - o servidor compara a versão recebida em `client:hello`;
 * - `client:hello` é a única mensagem aceita antes do handshake; todo o resto
 *   é recusado com `HANDSHAKE_REQUIRED`.
 */
export const PROTOCOL_NAME = 'prompt-warfare';

/** Suba este número sempre que o formato de qualquer mensagem WS/HTTP mudar. */
export const PROTOCOL_VERSION = 1;

/** Tempo máximo (ms) para o cliente enviar `client:hello` após abrir o WS. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

export type ProtocolFailureCode =
  | 'PROTOCOL_MISMATCH'
  | 'CLIENT_OUTDATED'
  | 'SERVER_OUTDATED'
  | 'PROTOCOL_UNREACHABLE';

/** Falhas de handshake emitidas pelo servidor antes de liberar o socket. */
export type HandshakeFailureCode = 'HANDSHAKE_REQUIRED' | 'HELLO_TIMEOUT';

export type BootFailureCode = ProtocolFailureCode | HandshakeFailureCode;

export interface ClientHelloPayload {
  protocol: string;
  protocolVersion: number;
  client: string;
}

export interface HelloAckPayload {
  protocol: string;
  protocolVersion: number;
}

export interface ProtocolCheck {
  ok: boolean;
  code: ProtocolFailureCode | null;
  remoteVersion: number | null;
  localVersion: number;
}

export function isProtocolVersion(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 1_000_000
  );
}

function failed(
  code: ProtocolFailureCode,
  remoteVersion: number | null,
  localVersion: number,
): ProtocolCheck {
  return { ok: false, code, remoteVersion, localVersion };
}

/**
 * Compara a versão do outro lado com a versão local. Nunca lança: entradas
 * inválidas viram `PROTOCOL_MISMATCH` para que o chamador bloqueie o jogo.
 */
export function checkProtocolVersion(
  remoteVersion: unknown,
  localVersion: number = PROTOCOL_VERSION,
): ProtocolCheck {
  if (!isProtocolVersion(remoteVersion)) {
    return failed('PROTOCOL_MISMATCH', null, localVersion);
  }
  if (remoteVersion === localVersion) {
    return { ok: true, code: null, remoteVersion, localVersion };
  }
  return failed(
    remoteVersion < localVersion ? 'CLIENT_OUTDATED' : 'SERVER_OUTDATED',
    remoteVersion,
    localVersion,
  );
}

export function buildClientHello(client = 'web'): ClientHelloPayload {
  return {
    protocol: PROTOCOL_NAME,
    protocolVersion: PROTOCOL_VERSION,
    client,
  };
}

/** Valida o `client:hello` recebido pelo servidor. */
export function evaluateHello(
  payload: unknown,
  localVersion: number = PROTOCOL_VERSION,
): ProtocolCheck {
  if (!payload || typeof payload !== 'object') {
    return failed('PROTOCOL_MISMATCH', null, localVersion);
  }
  const record = payload as Record<string, unknown>;
  if (record.protocol !== PROTOCOL_NAME) {
    return failed('PROTOCOL_MISMATCH', null, localVersion);
  }
  return checkProtocolVersion(record.protocolVersion, localVersion);
}

/** Valida o `client:hello_ack` recebido pelo cliente. */
export function evaluateHelloAck(
  payload: unknown,
  localVersion: number = PROTOCOL_VERSION,
): ProtocolCheck {
  return evaluateHello(payload, localVersion);
}

/** Valida a resposta de `/api/health` antes de liberar o cliente. */
export function checkHealthPayload(
  payload: unknown,
  localVersion: number = PROTOCOL_VERSION,
): ProtocolCheck {
  if (!payload || typeof payload !== 'object') {
    return failed('PROTOCOL_MISMATCH', null, localVersion);
  }
  const record = payload as Record<string, unknown>;
  if (record.protocol !== PROTOCOL_NAME) {
    return failed('PROTOCOL_MISMATCH', null, localVersion);
  }
  return checkProtocolVersion(record.protocolVersion, localVersion);
}

/** Códigos que o cliente trata como bloqueio de boot (não como erro de sala). */
const BOOT_CODES = new Set<string>([
  'PROTOCOL_MISMATCH',
  'CLIENT_OUTDATED',
  'SERVER_OUTDATED',
  'PROTOCOL_UNREACHABLE',
  'HANDSHAKE_REQUIRED',
  'HELLO_TIMEOUT',
]);

export function isBootFailureCode(code: unknown): code is BootFailureCode {
  return typeof code === 'string' && BOOT_CODES.has(code);
}

/** Texto pt-BR exibido no overlay/bloqueio de boot. */
export function describeProtocolFailure(code: ProtocolFailureCode | null): string {
  switch (code) {
    case 'CLIENT_OUTDATED':
      return 'Sua versão do jogo está desatualizada. Recarregue a página para atualizar.';
    case 'SERVER_OUTDATED':
      return 'O servidor do jogo está em manutenção. Tente novamente em instantes.';
    case 'PROTOCOL_UNREACHABLE':
      return 'Não foi possível falar com o servidor do jogo. Verifique sua conexão e tente novamente.';
    case 'PROTOCOL_MISMATCH':
    default:
      return 'O servidor respondeu em um formato incompatível com esta versão do jogo. Recarregue a página.';
  }
}
