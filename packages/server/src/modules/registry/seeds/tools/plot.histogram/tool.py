def run(values, output_path, bins=None, title=None):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import os
    if bins is None:
        bins = 50
    fig, ax = plt.subplots()
    ax.hist(values, bins=int(bins))
    if title is not None:
        ax.set_title(title)
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return {"path": os.path.abspath(output_path)}
