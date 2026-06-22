import os
import requests

TG_BOT_TOKEN = os.getenv("TG_BOT_TOKEN", "")
TG_CHAT_ID = os.getenv("TG_CHAT_ID", "")

def notify_rare_mushroom(username: str, mushroom_type: str, lat: float, lng: float):
    if not TG_BOT_TOKEN or not TG_CHAT_ID:
        return
    
    # Send notification if the mushroom is rare (e.g. white mushroom)
    rare_types = ['white']
    if mushroom_type in rare_types:
        msg = f"🍄 Пользователь {username} нашел Белый гриб!\nКоординаты: {lat}, {lng}"
        url = f"https://api.telegram.org/bot{TG_BOT_TOKEN}/sendMessage"
        try:
            requests.post(url, json={"chat_id": TG_CHAT_ID, "text": msg})
        except Exception as e:
            print(f"Error sending TG notification: {e}")
