#!/bin/bash
# ให้สิทธิ์ CREATE DATABASE แก่ btec user เพื่อให้ Prisma สร้าง shadow database ได้
# รันครั้งเดียวตอน container boot (docker-entrypoint-initdb.d)
set -e

mysql -u root -p"${MYSQL_ROOT_PASSWORD}" <<-EOSQL
  GRANT ALL PRIVILEGES ON *.* TO '${MYSQL_USER}'@'%' WITH GRANT OPTION;
  FLUSH PRIVILEGES;
EOSQL
