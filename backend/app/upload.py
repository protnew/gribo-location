import os
import boto3
import base64
from typing import List, Optional
from pydantic import BaseModel
from sqlalchemy.orm import Session
from fastapi import Depends

class PhotoUpload(BaseModel):
    client_id: str
    photo_data: str

def add_upload_route(app):
    @app.post("/api/upload")
    def upload_photo(data: PhotoUpload):
        # Task 7: Upload to MinIO/S3
        minio_url = os.getenv("MINIO_URL", "http://localhost:9000")
        access_key = os.getenv("MINIO_ACCESS_KEY", "gribo_admin")
        secret_key = os.getenv("MINIO_SECRET_KEY", "gribo_super_secret")
        
        try:
            s3 = boto3.client('s3',
                              endpoint_url=minio_url,
                              aws_access_key_id=access_key,
                              aws_secret_access_key=secret_key)
            try:
                s3.head_bucket(Bucket='gribo-photos')
            except:
                s3.create_bucket(Bucket='gribo-photos')
            
            img_data = base64.b64decode(data.photo_data.split(',')[1] if ',' in data.photo_data else data.photo_data)
            s3.put_object(Bucket='gribo-photos', Key=f"{data.client_id}.jpg", Body=img_data, ContentType="image/jpeg")
            
            return {"status": "uploaded", "url": f"{minio_url}/gribo-photos/{data.client_id}.jpg"}
        except Exception as e:
            # Fallback to local if MinIO is down (for local testing)
            os.makedirs("uploads", exist_ok=True)
            img_data = base64.b64decode(data.photo_data.split(',')[1] if ',' in data.photo_data else data.photo_data)
            with open(f"uploads/{data.client_id}.jpg", "wb") as f:
                f.write(img_data)
            return {"status": "uploaded", "url": f"/uploads/{data.client_id}.jpg", "warning": "minio offline"}
