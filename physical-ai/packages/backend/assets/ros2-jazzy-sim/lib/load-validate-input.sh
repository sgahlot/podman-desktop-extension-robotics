#!/usr/bin/env bash
# Locate and source validate-input.sh (same directory as this file, or PHYSICAL_AI_VALIDATE_LIB).
# Entrypoints source this loader from repo lib/ or /usr/local/lib/physical-ai/.
#
# Override: PHYSICAL_AI_VALIDATE_LIB=/path/to/validate-input.sh

_pai_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_pai_validate="${PHYSICAL_AI_VALIDATE_LIB:-${_pai_here}/validate-input.sh}"

if [[ ! -f "${_pai_validate}" ]]; then
  echo "error: validate-input.sh not found at '${_pai_validate}'" >&2
  return 1 2>/dev/null || exit 1
fi

# shellcheck source=validate-input.sh
source "${_pai_validate}"
unset _pai_here _pai_validate
