# Redis backups on the VM

- `/usr/local/bin/axi-redis-backup.sh` runs from `/etc/cron.d/axi-redis-backup` every 6 hours
  (at :15). It asks Redis for a snapshot (`BGSAVE`), copies `dump.rdb` (all DBs) to
  `/var/backups/axi-redis/redis-YYYYmmdd-HHMM.rdb`, verifies it with `redis-check-rdb`, and
  deletes copies older than 14 days. Log: `/var/log/axi-redis-backup.log`.
- It also keeps `env-latest.bak`, a copy of `/etc/axi-chat-backend.env`. Without
  `CHAT_ENCRYPTION_KEY` and `SANDESH_TOTP_ENC_KEY` from that file, a restored snapshot cannot be read.
- The directory is root-only (700) and the files are 600. **Everything is on the same disk as
  the live data** -- it protects against mistakes and corruption, not against losing the VM.
  Copy `/var/backups/axi-redis` somewhere else regularly.

## Restore (do this with the backend stopped)

    sudo systemctl stop axi-chat-backend
    sudo systemctl stop redis
    sudo cp /var/backups/axi-redis/redis-<stamp>.rdb /var/lib/redis/dump.rdb
    sudo chown redis:redis /var/lib/redis/dump.rdb
    sudo rm -f /var/lib/redis/appendonly.aof   # AOF is on: Redis would otherwise load it instead of the .rdb
    sudo systemctl start redis && sudo systemctl start axi-chat-backend

(Check `redis-cli CONFIG GET dir` for the real data directory first; use `appendonly` handling
appropriate to your setup.)

## Copy the backups off the VM

The snapshots live on the VM's own disk, so losing the VM would lose them too. Pull them to another machine regularly
(from a machine that can `ssh` to the VM, on the office network or VPN):

    mkdir -p ~/axi-backups && chmod 700 ~/axi-backups
    ssh axi-vm 'sudo -n tar -C /var/backups/axi-redis -cf - $(sudo -n ls /var/backups/axi-redis)' | tar -C ~/axi-backups -xf -
    chmod 600 ~/axi-backups/*

The folder holds the company's data and `env-latest.bak` (the keys needed to read a snapshot): keep it private, and delete
snapshots you no longer need. Removing a person's data "everywhere" also means removing it from these copies and from
older snapshots (`grep -qa <name> redis-*.rdb` finds which ones still contain it).
