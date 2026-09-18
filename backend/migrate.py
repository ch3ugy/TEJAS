from app.database import run_database_migrations

def run_migration():
    run_database_migrations()
    print("Database migrations completed.")

if __name__ == "__main__":
    run_migration()
