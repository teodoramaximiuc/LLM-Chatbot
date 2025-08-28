import chromadb
import openai
import json
import pprint as pprint
import os

from chromadb.utils import embedding_functions

openai_api_key = os.getenv("OPENAI_API_KEY")

openai_ef = embedding_functions.OpenAIEmbeddingFunction(
    api_key=openai_api_key,
    model_name="text-embedding-3-small",
    dimensions=1536
)
with open("book_sum.json", "r", encoding = "utf-8") as file:
    books = json.load(file)

chromadb_client = chromadb.PersistentClient(path="./chroma_db")

vectors = openai_ef([f"{book['Title']}. {book['Summary']} Genre: {', '.join(book['Genre'])}. " f"Tone: {', '.join(book['Tone'])}. Audience: {book['Audience']}." for book in books])
collection = chromadb_client.get_or_create_collection(name = "books")

collection.add(
    ids=[str(book["id"]) for book in books],
    documents=[
        f"{book['Title']}. {book['Summary']} "
        f"Genre: {', '.join(book['Genre'])}. "
        f"Tone: {', '.join(book['Tone'])}. "
        f"Audience: {book['Audience']}."
        for book in books
    ],
    metadatas=[
        {
            "id": int(book["id"]),
            "Title": book["Title"],
            "Summary": book["Summary"],
            "Author": book["Author"],
            "Year": int(book["Year"]),
            "Genre": ", ".join(book["Genre"]),
            "Rating": float(book["Rating"]),
            "Audience": book["Audience"],
            "Tone": ", ".join(book["Tone"])
        }
        for book in books
    ],
    embeddings = vectors
)

'''
## Query Test ##

query = "I want a book that has a lot of action and is about a mocking bird"
results = collection.query(
    query_embeddings=openai_ef([query]),
    n_results=4,
    include=["metadatas", "distances"]
)

print("Query Results:")
for result in results["metadatas"][0]:
    print(f"Title: {result['Title']}, ID: {result['id']}, Distance: {results['distances'][0][0]}", "Summary:", result['Summary'])
'''