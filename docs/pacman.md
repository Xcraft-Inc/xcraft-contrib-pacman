# pacman

Primary module that drives the `wpkg` command in order to make, build, install,
remove, etc,... packages.

- [`pacman.list`](#pacman.list)
- [`pacman.edit`](#pacman.edit)
- [`pacman.make`](#pacman.make)
- [`pacman.install`](#pacman.install)
- [`pacman.reinstall`](#pacman.reinstall)
- [`pacman.status`](#pacman.status)
- [`pacman.build`](#pacman.build)
- [`pacman.remove`](#pacman.remove)
- [`pacman.clean`](#pacman.clean)

## exported functions

### pacman.list

List all packages available in the `packages/` directory.

### pacman.edit

Create or edit a package [definition][2]. This function will start a wizard and
generates a new directory in the `packages/` directory. The [definition][2] is
stored in a `.yml` file.

### pacman.make

Generate a new package `.deb` accordingly to the [definitions][2]. This package
is saved in a local [repository][3].

It is possible to pass several packages or nothing. In the first case, all
packages will be generated. If nothing is passed, then all packages are
considered.

```sh
pacman.make                     # To make all packages.
pacman.make package1,package2   # To make only two packages.
```

Sometimes it is interesting to make a package will all its dependencies. The
following pattern `<-*` will do the trick. Of course, you can add other
packages.

```sh
pacman.make package1,<-*            # To make package1 and its dependencies.
pacman.make package1,<-*,package2   # To make package1, its dependencies and
                                    # the package2.
```

In some cases (like for Continuous Integration), you can overload some
properties for a specific package or all packages. The overload is done on
the properties available in the definition files.

```sh
pacman.make package1 \                # Overload the version of package1.
            p:version=1.0.0
pacman.make package1,package2 \       # Overload only the version of package1.
            p:package1:version=1.0.0  # In the case of package2, it will use
                                      # its own version.
```

It is possible to overload all packages with only one `p:` argument.

```sh
pacman.make package1,package2 \   # Overload the distribution globally.
            p:distribution=test/
pacman.make p:distribution=test/  # Like previous with all packages.
```

An other example very useful with a CI (when a tag is pushed for example).

```sh
pacman.make srcpackage,<-* \
            p:srcpackage:version=1.0.0 \
            p:srcpackage:data.get.ref=v1.0.0
```

It makes the srcpackage and its dependencies. The package will be created with
the version 1.0.0, and because this package is related to a *git* repository,
the tag *v1.0.0* will be used.

> In this case, the reference can be a commit, a branch or a tag.

#### Timestamps

A package is not re-maked if the files in its `packages/` have not changed.
A timestamp is saved in the `var/xcraft-contrib-pacman/` directory with the
current timestamp. Before a *make*, this timestamp is compared against all
timestamps (mtime) of the files available in `packages/`.

> Note that if a `data.get.uri` target has changed, this mechanism will not
> detect anything. File, repository, etc,... is only downloaded or copied
> by the [xcraft-contrib-peon][4] (*make* or *install* time, it depends if the
> package embeds the data or not).

Here an example where it can be a problem:

```yaml
# Part a y YAML definition file.
data:
  get:
    uri: home:///foobar
```

The `foobar/` directory is located in the toolchain, but for *pacman*, it is
just a data location like `http` for example. If you change something in the
`foobar/` directory, nothing will be detected by *pacman*.

> Note that the version should probably change in this case. Then the package
> will be processed because the definition file will have a newer timestamp.

### pacman.install

Install a package from the [repository][3] in the [`devroot/`][1]. The list of
available repositories depends of the current [`devroot/`][1] settings. If the
package is already installed, nothing happens. If the currently installed
package is older, then this action will upgrade with the new version.

Of course, all dependencies will be installed too. If a required dependency
is not found in the repository, the installation will fail.

#### MS Windows and MSI

Maybe you have a package with an *MSI* installer. In this case, it can be
possible that this *MSI* needs a reboot in order to continue the
installation. If it happens, you must restart the system, then you can send
the same command again, then the next dependencies will be installed as
expected.

> Note that the detection about a reboot necessity is still WIP.

See [xcraft-core-process][5] for more informations.

### pacman.reinstall

Unlike the install command, here it's possible to reinstall an already
installed package. Excepted for this case, the behaviors are the same that
the install command.

### pacman.status

It's possible to check if a package is already installed with this command.

### pacman.build

When a package is a *source* package, then it's possible to use this
command in order to generate a binary package. Then all build steps are
handled here. The new package is published in the repository. Then it's
possible to install this new package in `devroot/`.

Many steps are necessary in order to build a binary package.

TODO

### pacman.remove

When a package was installed in `devroot/`, this command provides the
possibility to uninstall.

### pacman.clean

The make command generates temporary files in `var/tmp/wpkg/`. Here, it's
possible to remove these files. The make command is already using the clean
command internally.


[1]: pacman.devroot.md
[2]: pacman.definition.md
[3]: pacman.repository.md
[4]: /xcraft-contrib-peon/docs/peon.md
[5]: /xcraft-core-process/docs/process.md
