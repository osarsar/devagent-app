#!/bin/bash
# DevAgent — One-line setup
# Usage: curl -sL https://raw.githubusercontent.com/osarsar/devagent-app/main/setup.sh | bash

set -e
git clone https://github.com/osarsar/devagent-app.git ~/devpilot/.devpilot/app
bash ~/devpilot/.devpilot/app/install.sh
