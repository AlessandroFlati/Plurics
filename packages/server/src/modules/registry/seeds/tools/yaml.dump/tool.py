def run(data, path):
    import yaml
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True)
    return {"written": True}
