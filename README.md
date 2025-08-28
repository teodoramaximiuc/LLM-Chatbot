# Smart Librarian 📙

A full-stack app that recommends books using **RAG (Retrieval-Augmented Generation)** with **OpenAI**.  
It includes a **React (Vite) frontend**, a **FastAPI** backend, a **persistent ChromaDB** vector store, optional **image generation**, optional **voice input (AssemblyAI)**, and optional **JWT auth** backed by **Oracle XE**.

<p align="center">
  <img src="/SCREENS/Login.png" alt="Login page" width="360">
  <img src="/SCREENS/chat-cheiaOpenAI-Inactiva.png" alt="Chat page" width="360">
</p>

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [.env Configuration](#env-configuration)
- [Quick Start (Docker)](#quick-start-docker)
- [Seeding ChromaDB](#seeding-chromadb)
- [Local Development (no Docker)](#local-development-no-docker)
- [API Endpoints](#api-endpoints)
- [Troubleshooting](#troubleshooting)
- [Notes on Oracle Auth (Optional)](#notes-on-oracle-auth-optional)
- [FAQ](#faq)
- [License](#license)

---

## Features

- **RAG over your books** with ChromaDB (persistent on disk)
- **OpenAI function calling** tools:
  - `search_books` (semantic search in the vector index)
  - `get_book_summary` (fetch summary by exact title)
- **Conversational answers** via `gpt-4o-mini`
- **Optional cover images** via `gpt-image-1`
- **Browser TTS** (Web Speech API)
- **Optional voice input** (AssemblyAI transcription)
- **Optional JWT auth** (login/signup) with Oracle XE (`BOTUSERS` table)

---

## Architecture

[Frontend: React/Vite] ⇄ [Backend: FastAPI]
| |
| ├─ OpenAI Chat (gpt-4o-mini) + Tools
| ├─ OpenAI Images (gpt-image-1) [optional]
| ├─ ChromaDB (persistent vector store)
| └─ Oracle XE (JWT auth, optional)
└─ Web Speech API (TTS) + AssemblyAI STT (optional)

---

## Tech Stack

- **Frontend:** React + Vite, Tailwind CSS, Web Speech API
- **Backend:** FastAPI, Uvicorn, OpenAI Python SDK
- **Vector DB:** ChromaDB (persistent client)
- **Auth (optional):** Oracle XE, `python-oracledb`, JWT (`python-jose`)
- **Voice (optional):** AssemblyAI for STT (client side), `pyttsx3` for backend TTS demo
- **Containerization:** Docker, Docker Compose

---

## Project Structure
.
├── backend/
│ ├── Dockerfile
│ ├── requirements.txt
│ └── server.py # FastAPI app (RAG + tools + optional Oracle auth)
├── frontend/
│ ├── Dockerfile
│ └── src/App.jsx # React UI (chat, mic, TTS, optional auth UI)
├── chroma_db_v5/ # (mounted) ChromaDB persistent store
├── static/ # generated assets (book covers)
│ └── cover.png
├── book_sum.json # titles + summaries used to seed the vector index
├── docker-compose.yml
├── .env # environment variables (create this)
└── README.md # this file
---

## Prerequisites

- **Docker** & **Docker Compose v2**
- **OpenAI API key**
- (Optional) **AssemblyAI API key** if you want voice input
- (Optional) If enabling auth: Oracle XE container runs automatically via Compose

---

## .env Configuration

Create a `.env` file in the project root:

```env
# Backend
OPENAI_API_KEY=sk-your-key
SECRET_KEY=please-change-me-to-a-long-random-string

# Oracle (only if you enable login/signup)
ORACLE_USER=SYSTEM
ORACLE_PASSWORD=parola123
# Choose one of these depending on the listener service:
# ORACLE_DSN=oracle-db:1521/XE
ORACLE_DSN=oracle-db:1521/XEPDB1

# Frontend (voice input)
VITE_ASSEMBLYAI_API_KEY=your_assemblyai_key