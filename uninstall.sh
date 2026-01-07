#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

INSTALL_DIR="${WP_MD_INSTALL_DIR:-$HOME/.wp-md}"
BIN_DIR="${WP_MD_BIN_DIR:-$HOME/.local/bin}"

info() {
    echo -e "${BLUE}INFO${NC} $1"
}

success() {
    echo -e "${GREEN}SUCCESS${NC} $1"
}

warn() {
    echo -e "${YELLOW}WARN${NC} $1"
}

error() {
    echo -e "${RED}ERROR${NC} $1"
}

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════╗"
echo "║       wp-md uninstaller                ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# Check for npm global installation
if command -v npm &> /dev/null; then
    NPM_GLOBAL=$(npm root -g 2>/dev/null || echo "")
    if [ -n "$NPM_GLOBAL" ] && [ -d "$NPM_GLOBAL/wp-md" ]; then
        info "Found npm global installation"
        read -p "Remove npm global package? [Y/n]: " remove_npm
        remove_npm=${remove_npm:-Y}

        if [[ "$remove_npm" =~ ^[Yy]$ ]]; then
            if npm uninstall -g wp-md 2>/dev/null; then
                success "Removed npm global package"
            else
                warn "Trying with sudo..."
                sudo npm uninstall -g wp-md && success "Removed npm global package"
            fi
        fi
    fi
fi

# Check for local installation
if [ -d "$INSTALL_DIR" ]; then
    info "Found local installation at $INSTALL_DIR"
    read -p "Remove local installation? [Y/n]: " remove_local
    remove_local=${remove_local:-Y}

    if [[ "$remove_local" =~ ^[Yy]$ ]]; then
        rm -rf "$INSTALL_DIR"
        success "Removed $INSTALL_DIR"
    fi
fi

# Check for symlink
if [ -L "$BIN_DIR/wp-md" ]; then
    info "Found symlink at $BIN_DIR/wp-md"
    rm "$BIN_DIR/wp-md"
    success "Removed symlink"
fi

# Note about PATH
SHELL_NAME=$(basename "$SHELL")
case "$SHELL_NAME" in
    bash)
        PROFILE="$HOME/.bashrc"
        [ -f "$HOME/.bash_profile" ] && PROFILE="$HOME/.bash_profile"
        ;;
    zsh)
        PROFILE="$HOME/.zshrc"
        ;;
    fish)
        PROFILE="$HOME/.config/fish/config.fish"
        ;;
    *)
        PROFILE="$HOME/.profile"
        ;;
esac

if grep -q "wp-md" "$PROFILE" 2>/dev/null; then
    warn "PATH entry found in $PROFILE"
    echo "You may want to manually remove the wp-md PATH entry"
fi

echo ""
success "wp-md has been uninstalled"
