# Multi-Database Neon Postgres Backup System (Next.js & Vercel Blob)

Sistem backup otomatis, mandiri, dan terpusat untuk **banyak database** sekaligus menggunakan **Vercel Blob Storage** sebagai storage backup. Dilengkapi dengan dashboard UI yang modern, terproteksi password, terenkripsi dua arah (AES-256-CBC) untuk kredensial database target, dan penjadwalan dinamis.

---

## 🛠️ Persyaratan & Stack
* **Framework**: Next.js (App Router, Server Actions, Middleware)
* **Config Database**: 1 Database Postgres utama (misal Neon free tier) untuk menyimpan metadata target backup.
* **Target Databases**: Banyak database PostgreSQL mana pun (Neon, AWS RDS, Supabase, dll.) yang ingin dibackup.
* **Storage**: Vercel Blob
* **Styling**: Tailwind CSS
* **Security**: AES-256-CBC untuk enkripsi kredensial target DB, terproteksi password untuk Dashboard UI.

---

## ⚙️ Cara Setup & Konfigurasi

### 1. Salin File Environment Variables
Salin `.env.example` menjadi `.env` di root project Anda:
```bash
cp .env.example .env
```
Isi variabel berikut:
* `DATABASE_URL`: URL koneksi ke **admin/config database** Anda (tempat menyimpan data pendaftaran database target, jadwal, dan logs).
* `BLOB_READ_WRITE_TOKEN`: Token otentikasi Vercel Blob (didapatkan di dashboard Vercel Anda).
* `BACKUP_SECRET`: Token acak rahasia untuk mengamankan cron endpoint.
* `DASHBOARD_PASSWORD`: Password untuk login ke admin panel dashboard.
* `ENCRYPTION_KEY`: Kunci enkripsi 32-byte (64 karakter heksadesimal) untuk mengamankan connection string target.
  *(Dapat digenerate via terminal: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)*

### 2. Aktifkan Vercel Blob di Project Vercel
1. Masuk ke console Vercel Anda dan pilih project Anda.
2. Pergi ke tab **Storage**, klik **Create Database**, lalu pilih **Blob**.
3. Klik **Connect** ke project Anda. Ini otomatis menambahkan `BLOB_READ_WRITE_TOKEN` ke environment variables project Anda.

### 3. Jalankan Migrasi Drizzle di Config Database
Jalankan perintah berikut untuk mempersiapkan tabel konfigurasi `databases` di config database Anda:
```bash
# Membuat migrasi baru
npx drizzle-kit generate

# Mendorong skema ke database utama
npx drizzle-kit push
```

### 4. Jalankan Aplikasi Secara Lokal
Jalankan development server Next.js:
```bash
npm run dev
```
Buka [http://localhost:3000](http://localhost:3000) di browser. Masukkan password yang Anda definisikan di `DASHBOARD_PASSWORD`.

---

## 🖥️ Fitur Dashboard Multi-Database
1. **Sidebar Target**: Menampilkan semua database terdaftar beserta status eksekusi backup terakhir (Hijau = Sukses, Merah = Gagal, Abu-abu = Belum jalan).
2. **Pendaftaran Mudah**: Tombol "+ Daftarkan DB Baru" untuk menambahkan database target baru hanya dengan memasukkan nama dan connection string.
3. **Keamanan Maksimal**: Setiap connection string database target di-enkripsi menggunakan algoritma **AES-256-CBC** di sisi server sebelum disimpan ke database config.
4. **Pengaturan Mandiri**: Setiap database target memiliki interval backup (3 hari, 1 minggu, 1 bulan, 1 tahun, kustom hari) dan batas jumlah file retensi (`max_files`) masing-masing.
5. **Daftar File & Pruning**: Menampilkan file backup khusus database terpilih di Vercel Blob (disimpan terpisah di folder `db-backups/db-{id}/`). File terlama otomatis dihapus jika melebihi batas retensi database tersebut.

---

## 🧪 Panduan Pengujian Sistem (End-to-End)

Kami telah menyiapkan script pengujian komprehensif di `scratch/test-backup.ts` untuk memastikan sistem berjalan 100% benar sebelum dideploy ke produksi.

### Cara Menjalankan Tes Lokal:
1. Pastikan Anda telah mengisi file `.env` dengan benar.
2. Jalankan perintah tes berikut di terminal Anda:
   ```bash
   npx tsx scratch/test-backup.ts
   ```

### Skenario yang Diuji:
1. **Enkripsi/Dekripsi Kredensial**: Tes memastikan connection string berhasil di-enkripsi dan di-dekripsi secara akurat menggunakan AES-256-CBC.
2. **Catalog Introspection & SQL DDL Dump**: Tes mendaftarkan database utama sendiri sebagai target, lalu memicu backup. Sistem akan mengueri katalog Postgres target secara dinamis untuk menyusun DDL tabel, primary keys, sequences, data baris `INSERT`, dan foreign keys (dengan tabel database config disensor secara otomatis agar tidak bocor ke file backup).
3. **Pengecekan Jadwal Dinamis**: Tes mensimulasikan status waktu sukses terakhir (8 hari lalu vs 1 hari lalu) untuk memverifikasi proses bypass cron otomatis.
4. **Retensi Pruning File**: Tes membatasi `max_files` menjadi `2` dan memicu backup 3 kali berturut-turut untuk memastikan file tertua di folder Vercel Blob database terkait berhasil terhapus secara otomatis.

---

## ♻️ Panduan Restore Database dari Backup

Setiap file backup disimpan dalam folder terpisah berdasarkan ID database (`db-backups/db-{id}/`) dalam format kompresi `.sql.gz`. Berikut cara restore-nya:

### Langkah 1: Unduh File Backup
Unduh file backup yang diinginkan dari dashboard UI (misal: `backup-2026-07-07T03-00-00.sql.gz`).

### Langkah 2: Ekstrak File Backup
Gunakan perintah `gunzip` untuk mengekstrak file SQL mentah:
```bash
gunzip backup-2026-07-07T03-00-00.sql.gz
# Ini akan menghasilkan file backup-2026-07-07T03-00-00.sql
```
*(Untuk Windows, Anda dapat menggunakan aplikasi ekstraksi seperti 7-Zip)*

### Langkah 3: Import ke Database Postgres Target
Jalankan file SQL tersebut ke database tujuan menggunakan tool CLI `psql` bawaan PostgreSQL:
```bash
psql "DATABASE_URL" -f backup-2026-07-07T03-00-00.sql
```
*Catatan: File SQL dump secara otomatis menonaktifkan pemeriksaan foreign key sementara (`SET session_replication_role = 'replica';`) agar data dapat dimasukkan dengan urutan apa pun tanpa melanggar constraint, lalu mengaktifkannya kembali di akhir proses restore.*
