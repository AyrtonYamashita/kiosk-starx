#!/bin/sh
# Backup diário do banco (serviço "backup" do docker-compose.yml).
# Com BACKUP_AGE_RECIPIENT (chave pública age, "age1..."), o dump sai cifrado: kiosk-AAAAMMDD-HHMM.sql.gz.age.
# Só a chave pública fica na VPS: quem invadir o servidor não consegue ler os backups. A chave privada fica com o
# responsável, fora do servidor (veja deploy/README.md, Backup). Sem a variável, o dump sai em claro, com aviso no log.
# Guarda os 14 mais novos (cifrados ou não, juntos): os antigos em claro somem sozinhos em 14 dias.
set -u
KEEP="${BACKUP_KEEP:-14}"
DIR=/backups

if [ -n "${BACKUP_AGE_RECIPIENT:-}" ] && ! command -v age >/dev/null 2>&1; then
  apk add --no-cache age >/dev/null 2>&1 || echo "backup: não consegui instalar o age"
fi

once() {
  stamp=$(date +%Y%m%d-%H%M)
  if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
    f="$DIR/kiosk-$stamp.sql.gz.age"
    if pg_dump -h "${PGHOST:-postgres}" -U kiosk kiosk | gzip | age -r "$BACKUP_AGE_RECIPIENT" > "$f.tmp"; then
      mv "$f.tmp" "$f"; echo "backup $f (cifrado)"
    else
      rm -f "$f.tmp"; echo "backup falhou"
    fi
  else
    f="$DIR/kiosk-$stamp.sql.gz"
    echo "backup: AVISO — BACKUP_AGE_RECIPIENT não definido, o backup sai em claro"
    if pg_dump -h "${PGHOST:-postgres}" -U kiosk kiosk | gzip > "$f.tmp"; then
      mv "$f.tmp" "$f"; echo "backup $f"
    else
      rm -f "$f.tmp"; echo "backup falhou"
    fi
  fi
  # rotação: os KEEP mais novos entre cifrados e em claro
  ls -1t "$DIR"/kiosk-*.sql.gz "$DIR"/kiosk-*.sql.gz.age 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
}

if [ "${1:-}" = "--once" ]; then
  once
  exit 0
fi
while true; do
  once
  sleep 86400
done
