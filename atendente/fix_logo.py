from PIL import Image

def trim_and_transparent(filepath):
    img = Image.open(filepath).convert("RGBA")
    data = img.load()
    width, height = img.size
    
    # Find bounding box of non-white pixels
    min_x = width
    min_y = height
    max_x = 0
    max_y = 0
    
    for y in range(height):
        for x in range(width):
            r, g, b, a = data[x, y]
            # Consider non-white if RGB sum < 750 (meaning at least one channel is significantly dark)
            if r + g + b < 750 and a > 0:
                if x < min_x: min_x = x
                if y < min_y: min_y = y
                if x > max_x: max_x = x
                if y > max_y: max_y = y

    if min_x > max_x or min_y > max_y:
        print("Image is entirely white or blank.")
        return

    # Add a small padding (e.g. 5 pixels)
    padding = 0
    min_x = max(0, min_x - padding)
    min_y = max(0, min_y - padding)
    max_x = min(width - 1, max_x + padding)
    max_y = min(height - 1, max_y + padding)
    
    # Crop the image
    img = img.crop((min_x, min_y, max_x + 1, max_y + 1))
    
    # Now replace near-white pixels with transparent
    data = img.load()
    width, height = img.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = data[x, y]
            if r > 240 and g > 240 and b > 240:
                # Calculate alpha based on how close to white
                avg = (r + g + b) / 3
                # 240 -> 255 alpha, 255 -> 0 alpha
                new_a = int(255 - (avg - 240) * 17)
                new_a = max(0, min(a, new_a))
                data[x, y] = (r, g, b, new_a)

    img.save("public/assets/logo_fixed.png", "PNG")
    print("Fixed image saved to logo_fixed.png")

trim_and_transparent("public/assets/logo.png")
