cmake_minimum_required (VERSION 3.0)

set(CPACK_SOURCE_GENERATOR "TGZ")
set(CPACK_SOURCE_PACKAGE_FILE_NAME "<PACKAGE.NAME>_<PACKAGE.VERSION>")

include(CPack)

add_custom_target(peonMake
                  ALL ./<PACKAGE.MAKEALL> cmake "${CMAKE_BINARY_DIR}"
                  WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}")

add_custom_target(run_unit_tests COMMAND echo "Skipping.")
