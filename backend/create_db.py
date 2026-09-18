import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

def create_database():
    try:
        # Connect to the default 'postgres' database to issue CREATE DATABASE command
        conn = psycopg2.connect(
            dbname="postgres",
            user="postgres",
            password="Ramesh@04",
            host="localhost",
            port="5432"
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        
        # Check if database exists
        cursor.execute("SELECT 1 FROM pg_catalog.pg_database WHERE datname = 'tejas_surveillance'")
        exists = cursor.fetchone()
        
        if not exists:
            cursor.execute('CREATE DATABASE tejas_surveillance')
            print("Database tejas_surveillance created successfully.")
        else:
            print("Database tejas_surveillance already exists.")
            
        cursor.close()
        conn.close()
    except Exception as e:
        print(f"Error creating database: {e}")

if __name__ == "__main__":
    create_database()
