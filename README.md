# Neon Postgres Backup System (Next.js & Vercel Blob)

Sistem backup otomatis dan mandiri untuk database **Neon Postgres** yang di-hosting di **Vercel** menggunakan **Vercel Blob Storage** sebagai storage backup. Dilengkapi dengan dashboard UI yang modern, terproteksi password, dan dinamis.

---

## 🛠️ Persyaratan & Stack
* **Framework**: Next.js (App Router, Server Actions, Middleware)
* **Database**: Neon Postgres (Gratis/Berbayar)
* **ORM**: Drizzle ORM & Drizzle Kit
* **Driver**: Neon Serverless (untuk normal query) & `pg` TCP client (untuk dump backup stabil)
* **Storage**: Vercel Blob
* **Styling**: Tailwind CSS

---

## ⚙️ Cara Setup & Konfigurasi

### 1. Salin File Environment Variables
Salin `.env.example` menjadi `.env.local` untuk development lokal, atau masukkan di dashboard Vercel settings untuk production:
```bash
cp .env.example .env.local
```
Isi variabel berikut:
* `DATABASE_URL`: URL koneksi utama database Neon Anda.
* `BLOB_READ_WRITE_TOKEN`: Token otentikasi Vercel Blob (bisa didapatkan di tab Storage dashboard Vercel Anda).
* `BACKUP_SECRET`: Token acak rahasia untuk otentikasi pemicu cron API (misal: `uuid` panjang).
* `DASHBOARD_PASSWORD`: Password untuk masuk ke dashboard UI.

### 2. Aktifkan Vercel Blob di Project Vercel
1. Masuk ke console Vercel Anda dan pilih project Anda.
2. Pergi ke tab **Storage**, lalu klik **Create Database** dan pilih **Blob**.
3. Klik **Connect** ke project Anda. Ini otomatis menambahkan environment variable `BLOB_READ_WRITE_TOKEN` ke project Anda.

### 3. Generate dan Jalankan Migrasi Database
Jalankan perintah berikut untuk membuat tabel setting dan data sampel di database Neon Anda:
```bash
# Membuat migrasi baru berdasarkan skema Drizzle
npx drizzle-kit generate

# Mendorong migrasi ke database Neon
npx drizzle-kit push
```

### 4. Jalankan Aplikasi Secara Lokal
Jalankan development server Next.js:
```bash
npm run dev
```
Buka [http://localhost:3000](http://localhost:3000) di browser. Masukkan password yang Anda definisikan di `DASHBOARD_PASSWORD`.

---

## 🖥️ Fitur Dashboard
Dashboard terproteksi password ini menyediakan antarmuka terpusat untuk:
1. **Status Backup**: Indikator kesehatan backup terakhir (Sukses/Gagal lengkap dengan pesan error jika ada), waktu eksekusi terakhir, serta perkiraan jadwal backup berikutnya.
2. **Pengaturan Dinamis**: Mengubah frekuensi backup otomatis (3 Hari, 1 Minggu, 1 Bulan, 1 Tahun, atau Kustom hari) dan batas jumlah file backup (Retention limit).
3. **Daftar File**: Menampilkan semua backup `.sql.gz` yang tersimpan di Vercel Blob secara real-time dengan tombol download langsung dan tombol hapus manual.
4. **Backup Manual (Override)**: Tombol "Backup Sekarang" untuk langsung mem-backup database tanpa menunggu jadwal interval cron terlampaui.

---

## 🧪 Panduan Pengujian Sistem (End-to-End)

Kami telah menyiapkan script pengujian komprehensif di `scratch/test-backup.ts` untuk memastikan sistem berjalan 100% benar sebelum dideploy ke produksi.

### Cara Menjalankan Tes Lokal:
1. Pastikan Anda telah mengisi `.env.local` dengan benar.
2. Jalankan perintah tes berikut di terminal Anda:
   ```bash
   npx tsx scratch/test-backup.ts
   ```

### Skenario yang Diuji:
1. **Aturan Penjadwalan Otomatis**:
   * Tes memodifikasi status database seolah-olah backup terakhir berhasil **8 hari yang lalu** (dengan interval 7 hari). Tes memastikan backup **berhasil terpancing** (tidak skip).
   * Tes memodifikasi status seolah-olah backup terakhir berhasil **1 hari yang lalu** (dengan interval 7 hari). Tes memastikan backup **berhasil dilewati (skipped)**.
2. **Aturan Retensi File (Max Files)**:
   * Tes mengubah batas `max_files` menjadi `2`.
   * Tes memicu backup manual sebanyak 3 kali berturut-turut.
   * Tes memverifikasi bahwa file tertua otomatis dihapus dari Vercel Blob, dan menyisakan tepat 2 file backup terbaru di storage.

---

## ♻️ Panduan Restore Database dari Backup

File backup yang dihasilkan berupa file kompresi `.sql.gz`. Berikut adalah cara me-restore database Anda menggunakan file hasil backup tersebut:

### Langkah 1: Unduh File Backup
Unduh file backup yang diinginkan dari dashboard UI (misal: `backup-2026-07-07T03-00-00.sql.gz`).

### Langkah 2: Ekstrak File Backup
Gunakan perintah `gunzip` untuk mengekstrak file SQL mentah:
```bash
gunzip backup-2026-07-07T03-00-00.sql.gz
# Ini akan menghasilkan file backup-2026-07-07T03-00-00.sql
```
*(Untuk Windows, Anda dapat menggunakan aplikasi ekstraksi seperti 7-Zip)*

### Langkah 3: Import ke Database Postgres
Jalankan file SQL tersebut ke database tujuan menggunakan tool CLI `psql` bawaan PostgreSQL:
```bash
psql "DATABASE_URL" -f backup-2026-07-07T03-00-00.sql
```
*Catatan: File SQL dump secara otomatis menonaktifkan pemeriksaan foreign key sementara (`SET session_replication_role = 'replica';`) agar data dapat dimasukkan dengan urutan apa pun tanpa melanggar constraint, lalu mengaktifkannya kembali di akhir proses restore.*
