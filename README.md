# Den Haag in 3D - Deployment Guide

This is a static website project that can be deployed to GitHub Pages, Netlify, or any static hosting service.

## Project Structure

```
/
├── index.html          # Main HTML file
├── css/
│   └── style.css      # Stylesheet
├── js/
│   └── transport.js    # JavaScript for transport functionality
└── assets/
    └── images/        # All image assets
```

## Deployment Instructions

### Option 1: GitHub Pages (Recommended)

#### Step 1: Initialize Git Repository

1. Open Terminal/Command Prompt in the project directory
2. Initialize a git repository:
   ```bash
   git init
   ```

#### Step 2: Create .gitignore (Optional but Recommended)

Create a `.gitignore` file to exclude unnecessary files:
```
.DS_Store
*.log
node_modules/
.vscode/
.idea/
```

#### Step 3: Add and Commit Files

```bash
git add .
git commit -m "Initial commit: Den Haag in 3D static site"
```

#### Step 4: Create GitHub Repository

1. Go to [GitHub](https://github.com) and sign in
2. Click the "+" icon in the top right corner
3. Select "New repository"
4. Name your repository (e.g., `den-haag-3d`)
5. **Do NOT** initialize with README, .gitignore, or license (we already have files)
6. Click "Create repository"

#### Step 5: Push to GitHub

GitHub will show you commands. Run these in your terminal:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

Replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your actual GitHub username and repository name.

#### Step 6: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click on "Settings" (top menu)
3. Scroll down to "Pages" in the left sidebar
4. Under "Source", select "Deploy from a branch"
5. Choose "main" branch and "/ (root)" folder
6. Click "Save"
7. Wait a few minutes for GitHub to build your site
8. Your site will be available at: `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

**Note:** It may take 5-10 minutes for the site to be accessible after enabling Pages.

---

### Option 2: Netlify

#### Step 1: Prepare Your Project

Make sure your project is in a Git repository (follow Steps 1-3 from GitHub Pages above, or push to GitHub first).

#### Step 2: Deploy to Netlify

**Method A: Drag and Drop (Easiest)**

1. Go to [Netlify](https://www.netlify.com) and sign up/login
2. On the dashboard, find the "Sites" section
3. Drag and drop your project folder (the one containing `index.html`) onto the Netlify dashboard
4. Netlify will automatically deploy your site
5. Your site will be available at a URL like: `https://random-name-123.netlify.app`

**Method B: Connect to GitHub**

1. Go to [Netlify](https://www.netlify.com) and sign up/login
2. Click "Add new site" → "Import an existing project"
3. Choose "Deploy with GitHub"
4. Authorize Netlify to access your GitHub account
5. Select your repository
6. Netlify will detect it's a static site automatically
7. Click "Deploy site"
8. Your site will be available at a custom URL

#### Step 3: Custom Domain (Optional)

1. In Netlify dashboard, go to "Domain settings"
2. Click "Add custom domain"
3. Follow the instructions to connect your domain

---

## Important Notes

### File Paths

All file paths in this project use **relative paths**, which means:
- ✅ `css/style.css` (works on any domain)
- ✅ `assets/images/icon.png` (works on any domain)
- ❌ `http://127.0.0.1:5500/css/style.css` (only works locally)

The project has been configured to work on any hosting service without modification.

### Google Maps API Key

The project uses Google Maps API. The API key is currently embedded in `index.html`. 

**Important:** If you plan to make this site public, you should:
1. Restrict the API key to your domain in Google Cloud Console
2. Consider using environment variables for the API key (requires build process)

To restrict your API key:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to "APIs & Services" → "Credentials"
3. Find your API key and click "Edit"
4. Under "Application restrictions", select "HTTP referrers"
5. Add your domain (e.g., `https://yourusername.github.io/*`)
6. Save

### Missing Files

The project references `js/transport-planner.js`, but this file may not exist. The code handles this gracefully with error checking. If you need this functionality, you'll need to add the file.

---

## Testing Locally

Before deploying, you can test the site locally:

1. **Using Python (if installed):**
   ```bash
   python3 -m http.server 8000
   ```
   Then open: `http://localhost:8000`

2. **Using Node.js (if installed):**
   ```bash
   npx serve
   ```
   Then open the URL shown in the terminal

3. **Using VS Code Live Server:**
   - Install the "Live Server" extension
   - Right-click on `index.html` → "Open with Live Server"

---

## Troubleshooting

### Images Not Loading

- Check that all image paths use `assets/images/` (not `images/`)
- Verify that images exist in the `assets/images/` folder
- Check browser console for 404 errors

### CSS Not Loading

- Verify `css/style.css` exists
- Check that the link in `index.html` points to `css/style.css`
- Clear browser cache (Ctrl+Shift+R or Cmd+Shift+R)

### JavaScript Errors

- Check browser console for errors
- Verify `js/transport.js` exists and is loaded
- Make sure Google Maps API key is valid

### GitHub Pages Not Updating

- Wait 5-10 minutes after pushing changes
- Check GitHub Actions tab for build errors
- Verify you're pushing to the correct branch (usually `main`)

---

## Support

For issues with:
- **GitHub Pages:** Check [GitHub Pages documentation](https://docs.github.com/en/pages)
- **Netlify:** Check [Netlify documentation](https://docs.netlify.com/)
- **Google Maps API:** Check [Google Maps Platform documentation](https://developers.google.com/maps/documentation)

---

## License

This project is for the Municipality of The Hague.

