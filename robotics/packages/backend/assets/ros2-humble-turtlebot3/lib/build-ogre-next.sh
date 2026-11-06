#!/usr/bin/env bash
# Preserve OSRF's OGRE 2.3.1 packaging/ABI, adding the upstream lifetime fix.
# Used by both architectures of the managed Humble/Harmonic image.
set -eo pipefail
export DEBIAN_FRONTEND=noninteractive
VERSION=2.3.1-9osrf~jammy
SOURCE_URL=https://packages.osrfoundation.org/gazebo/ubuntu-stable/pool/main/o/ogre-next-2.3
PROVENANCE=/opt/physical-ai/sources/ogre-next
WORK=/tmp/ogre-next-build
mkdir -p "${PROVENANCE}" "${WORK}"
sed 's/^deb /deb-src /' /etc/apt/sources.list.d/gazebo-stable.list \
  > /etc/apt/sources.list.d/gazebo-source.list
apt-get update -qq
apt-get install -y --no-install-recommends dpkg-dev patch
apt-get build-dep -y --arch-only "ogre-next-2.3=${VERSION}"
cd "${PROVENANCE}"
wget -q "${SOURCE_URL}/ogre-next-2.3_${VERSION}.dsc"
wget -q "${SOURCE_URL}/ogre-next-2.3_2.3.1.orig.tar.xz"
wget -q "${SOURCE_URL}/ogre-next-2.3_${VERSION}.debian.tar.xz"
sha256sum -c <<'CHECKSUMS'
9e6684575bb467007efc7bde616c82903643fd890dbe8681bd1b4fffd0597a6a  ogre-next-2.3_2.3.1-9osrf~jammy.dsc
a0d179b78612469ecd2a02f4e1eaecba6af95ac40b84126dd6fbc31cdbbb2138  ogre-next-2.3_2.3.1.orig.tar.xz
6b083006969b597db1d91cb6699fa7a6c2ac5ad7b7303947f50de16c4030f851  ogre-next-2.3_2.3.1-9osrf~jammy.debian.tar.xz
2fcfe57681948d52a0498f6bf44d1c41eb183ff00ea29bc94b23f05dac98cb08  material-lifetime.patch
CHECKSUMS
dpkg-source -x "ogre-next-2.3_${VERSION}.dsc" "${WORK}/source"
cd "${WORK}/source"
patch --fuzz=0 -p1 < "${PROVENANCE}/material-lifetime.patch"
sed -i '1s/2.3.1-9osrf~jammy/2.3.1-9osrf~jammy+physicalai1/' debian/changelog
export DEB_BUILD_OPTIONS='nocheck parallel=2'
dpkg-buildpackage -B -uc -us -j2
# Install the matching dev package too: OSRF renderer packages depend on it.
# Refuse dependency-driven removals rather than silently dropping OGRE2 itself.
apt-get install -y --no-remove --no-install-recommends \
  "${WORK}"/libogre-next-2.3.0_*physicalai1_*.deb \
  "${WORK}"/libogre-next-2.3-dev_*physicalai1_*.deb
# Debian preserves reproducible package timestamps. A replacement with the same
# size/mtime as its parent can be omitted by the image builder's layer diff,
# leaving old bytes behind despite the updated dpkg status. Refresh regular
# package files and their checksum metadata before the layer is committed.
dpkg-query -L libogre-next-2.3.0 libogre-next-2.3-dev | while IFS= read -r file; do
  if [[ -f "${file}" && ! -L "${file}" ]]; then
    touch -- "${file}"
  fi
done
touch /var/lib/dpkg/info/libogre-next-2.3*.md5sums
LIBDIR="/usr/lib/$(dpkg-architecture -qDEB_HOST_MULTIARCH)"
test -f "${LIBDIR}/gz-rendering-8/engine-plugins/libgz-rendering-ogre2.so"
ldd "${LIBDIR}/gz-rendering-8/engine-plugins/libgz-rendering-ogre2.so" > "${PROVENANCE}/renderer-linkage.txt"
if grep -q 'not found' "${PROVENANCE}/renderer-linkage.txt"; then
  cat "${PROVENANCE}/renderer-linkage.txt" >&2
  exit 1
fi
grep -F "${LIBDIR}/OGRE-2.3/libOgreNextMain.so.2.3.1" "${PROVENANCE}/renderer-linkage.txt"
dpkg-query -W libogre-next-2.3.0 > "${PROVENANCE}/installed-version.txt"
sha256sum /usr/lib/"$(dpkg-architecture -qDEB_HOST_MULTIARCH)"/OGRE-2.3/libOgreNextMain.so.2.3.1 \
  > "${PROVENANCE}/installed-library.sha256"
cd /
rm -rf "${WORK}" /var/lib/apt/lists/*
sha256sum -c "${PROVENANCE}/installed-library.sha256"
