def run(matrix, output_path, title=None, cmap=None):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import seaborn as sns
    import os
    if cmap is None:
        cmap = "viridis"
    fig, ax = plt.subplots()
    sns.heatmap(matrix, cmap=cmap, ax=ax)
    if title is not None:
        ax.set_title(title)
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return {"path": os.path.abspath(output_path)}
