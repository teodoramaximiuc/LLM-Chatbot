from fastapi import FastAPI
from fastapi import HTTPException
from pydantic import BaseModel
from fastapi import Header, Depends
from jose import jwt
from datetime import datetime, timedelta, timezone
from chromadb.utils import embedding_functions
from better_profanity import profanity
from openai import OpenAI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv, find_dotenv
import speech_recognition as sr
import pyttsx3
import base64
import chromadb
import oracledb
import os
import json

for k in ("HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","http_proxy","https_proxy","all_proxy"):
    os.environ.pop(k, None)

dotenv_path = find_dotenv()
print("Using .env at:", dotenv_path)
load_dotenv(dotenv_path=dotenv_path, override=True)

client = chromadb.PersistentClient(path="./chroma_db")
collection = client.get_or_create_collection(name="books")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
oai = OpenAI()
print("OpenAI API Key:", OPENAI_API_KEY)
system_prompt = """
You are a virtual librarian and book consultant.
Style: concise, friendly, clear. Do not reveal reasoning steps.
Goal: respond to fit user’s request.
When relevant, take into account: Genre, Tone, Audience, Rating, Year.
Do not invent information: use only the provided context.
"""

app = FastAPI()

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

r = sr.Recognizer()

print("USER:", os.getenv("ORACLE_USER"))
print("PASSWORD:", os.getenv("ORACLE_PASSWORD"))
print("DSN:", os.getenv("ORACLE_DSN"))

conn = oracledb.connect(
    user=os.getenv("ORACLE_USER"),
    password=os.getenv("ORACLE_PASSWORD"),
    dsn=os.getenv("ORACLE_DSN")
)

cur = conn.cursor()

openai_ef = embedding_functions.OpenAIEmbeddingFunction(
    api_key=OPENAI_API_KEY,
    model_name="text-embedding-3-small"
)
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is not set!")
ALGORITHM = "HS256"

class Token(BaseModel):
    access_token: str
    token_type: str

class User(BaseModel):
    name: str
    password: str

class ChatRequest(BaseModel):
    prompt: str
    generate_image: bool = True

with open("book_sum.json", "r", encoding="utf-8") as f:
    summaries_list = json.load(f)

book_summaries_dict = {item["Title"]: item["Summary"] for item in summaries_list}

def get_summary_by_title(title: str) -> str | None:
    return book_summaries_dict.get(title)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_books",
            "description": "Caută cărți relevante în indexul vectorial și întoarce top K rezultate.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Întrebarea utilizatorului"},
                    "k": {"type": "integer", "description": "Număr rezultate", "default": 4, "minimum": 1, "maximum": 10}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_book_summary",
            "description": "Returnează sumarul unei cărți după titlu exact.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Titlul cărții"}
                },
                "required": ["title"]
            }
        }
    }
]

def tool_search_books(query: str, k: int = 4):
    emb = openai_ef([query])[0]
    res = collection.query(
        query_embeddings=[emb],
        n_results=int(k),
        include=["documents","metadatas","distances"]
    )
    items = []
    for i, meta in enumerate(res["metadatas"][0]):
        items.append({
            "title": meta.get("Title"),
            "id": meta.get("id"),
            "distance": float(res["distances"][0][i]),
            "document": (res["documents"][0][i] if res["documents"] else None)
        })
    return {"results": items}

def tool_get_book_summary(title: str):
    return {"title": title, "summary": get_summary_by_title(title)}
    
TOOL_DISPATCH = {
    "search_books": tool_search_books,
    "get_book_summary": tool_get_book_summary,
}

def get_current_user(authorization: str = Header(...)):
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid token header")
    token = parts[1].strip()
    payload = verify_token(token)
    return payload["sub"]

def verify_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        print("[AUTH ERROR] Token expired")
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.JWTClaimsError as e:
        print(f"[AUTH ERROR] Invalid claims: {str(e)}")
        raise HTTPException(status_code=401, detail=f"Invalid claims: {str(e)}")
    except jwt.JWTError as e:
        print(f"[AUTH ERROR] Invalid token: {str(e)}")
        raise HTTPException(status_code=401, detail=f"Invalid token!: {str(e)}")
    except Exception as e:
        print(f"[AUTH ERROR] Unexpected error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal authentication error")
    
def hash_password(password: str):
    import hashlib
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(plain_password: str, hashed_password: str):
    return hash_password(plain_password) == hashed_password

@app.post("/chat")
async def chat(req: ChatRequest, user: str = Depends(get_current_user)):
    query = req.prompt.strip()
    if profanity.contains_profanity(query):
        return {"message": "Please speak respectfully 🙂."}

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": query},
    ]

    first = oai.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        tools=TOOLS,
        tool_choice="auto",
        temperature=0.7,
    )

    msg = first.choices[0].message
    tool_calls = getattr(msg, "tool_calls", None)

    while tool_calls:
        messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": [tc.dict() for tc in tool_calls]})

        for tc in tool_calls:
            name = tc.function.name
            args = json.loads(tc.function.arguments or "{}")
            try:
                result = TOOL_DISPATCH[name](**args)
            except Exception as e:
                result = {"error": str(e)}

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "name": name,
                "content": json.dumps(result, ensure_ascii=False)
            })

        followup = oai.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
            temperature=0.7,
        )
        msg = followup.choices[0].message
        tool_calls = getattr(msg, "tool_calls", None)

    text = (msg.content or "").strip()

    recommended_title = None
    for title in book_summaries_dict.keys():
        if title and title.lower() in text.lower():
            recommended_title = title
            break

    summary = get_summary_by_title(recommended_title) if recommended_title else None

    image_b64 = None
    if req.generate_image and recommended_title:
        try:
            img_resp = oai.images.generate(
                model="gpt-image-1",
                prompt=f"An artistic book cover style illustration for '{recommended_title}'",
                quality="low",
                n=1
            )
            image_b64 = img_resp.data[0].b64_json
            os.makedirs("static", exist_ok=True)
            with open("static/cover.png", "wb") as f:
                f.write(base64.b64decode(image_b64))
        except Exception as e:
            print(f"[IMG ERROR] {e}")

    return {
        "message": text or "I couldn't find a good match.",
        "summary": summary,
        "title": recommended_title,
        "image_b64": image_b64
    }

@app.post("/chat/speech")
async def chat_speech(user: str = Depends(get_current_user)):
    with sr.Microphone() as source:
        print("Please speak your query:")
        audio = r.listen(source)
    try:
        query = r.recognize_google(audio)
        chat_request = ChatRequest(prompt=query)
        response = await chat(chat_request, user)
        engine = pyttsx3.init()
        engine.say(response["message"])
        engine.runAndWait()
        return {"message": response["message"]}
    except sr.UnknownValueError:
        raise HTTPException(status_code=400, detail="Could not understand the audio")

@app.post("/login")
async def login(user: User):
    cur.execute("SELECT * FROM botusers WHERE username = :username", {"username": user.name})
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    if verify_password(user.password, row[2]):
        now = datetime.now(timezone.utc)
        expire = now + timedelta(minutes=30)
        token = jwt.encode({"sub": user.name, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)
        return Token(access_token=token, token_type="bearer")
    raise HTTPException(status_code=401, detail="Invalid username or password")

@app.post("/signup")
async def signup(user: User):
    cur.execute("SELECT * FROM botusers WHERE username = :username", {"username": user.name})
    if cur.fetchone():
        return {"message": "Username already exists, please choose another one"}
    user.password = hash_password(user.password)
    cur.execute("SELECT NVL(MAX(id), 0) + 1 FROM botusers")
    new_id = cur.fetchone()[0]
    cur.execute(
        "INSERT INTO botusers (id, username, password) VALUES (:id, :username, :password)",
        {"id": new_id, "username": user.name, "password": user.password}
    )
    conn.commit()
    return {"message": "User created successfully, you can now login"}

@app.post("/logout")
async def logout():
    return {"message": "Logout successful. Please delete the token on the client side."}