from flask import Flask
from routes import register_routes

app = Flask(__name__)
register_routes(app)

if __name__ == "__main__":
    app.run(debug=False, use_reloader=False, host="0.0.0.0", port=5000, threaded=False)